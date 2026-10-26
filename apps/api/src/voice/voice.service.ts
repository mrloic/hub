import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
  TokenVerifier,
} from "livekit-server-sdk";
import type { Prisma, VoiceLease } from "@prisma/client";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import { Database } from "../common/database";
import { config } from "../common/config";
import { voiceConfig as cfg } from "./voice.config";
import type { AuthRequest } from "../auth/session.service";
@Injectable()
export class VoiceService implements OnModuleInit, OnModuleDestroy {
  private client = new RoomServiceClient(cfg.url, cfg.key, cfg.secret, {
    requestTimeout: 4,
  });
  private sockets = new Map<string, Set<Duplex>>();
  private timer?: NodeJS.Timeout;
  private sweeping = false;
  constructor(private readonly db: Database) {}
  onModuleInit() {
    if (cfg.enabled)
      this.timer = setInterval(() => {
        void this.sweep();
      }, 2000);
  }
  onModuleDestroy() {
    clearInterval(this.timer);
    for (const set of this.sockets.values())
      for (const socket of set) socket.destroy();
  }
  enabled() {
    if (!cfg.enabled)
      throw new ServiceUnavailableException("Голос временно выключен.");
  }
  private async locked<T>(
    userId: string,
    action: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        return action(tx);
      },
      { timeout: 12000 },
    );
  }
  private async valid(tx: Prisma.TransactionClient, lease: VoiceLease) {
    if (lease.revoked) return false;
    const session = await tx.session.findUnique({
      where: { id: lease.sessionId },
    });
    if (
      !session ||
      session.userId !== lease.userId ||
      session.expiresAt.getTime() <= Date.now()
    )
      return false;
    const channel = await tx.channel.findUnique({
      where: { id: lease.channelId },
    });
    if (
      !channel ||
      channel.type !== "VOICE" ||
      channel.communityId !== lease.communityId
    )
      return false;
    return !!(await tx.membership.findUnique({
      where: {
        communityId_userId: {
          communityId: lease.communityId,
          userId: lease.userId,
        },
      },
    }));
  }
  private closeSignals(leaseId: string) {
    for (const socket of this.sockets.get(leaseId) ?? []) socket.destroy();
    this.sockets.delete(leaseId);
  }
  private async remove(lease: VoiceLease) {
    this.closeSignals(lease.id);
    try {
      await this.client.removeParticipant(lease.room, lease.userId);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "not_found"
      ))
        throw new ServiceUnavailableException(
          "Медиасервер недоступен. Повторите попытку.",
        );
    }
  }
  async join(req: AuthRequest, channelId: string) {
    this.enabled();
    return this.locked(req.session.userId, async (tx) => {
      const channel = await tx.channel.findUnique({ where: { id: channelId } });
      if (!channel || channel.type !== "VOICE")
        throw new NotFoundException("Голосовой канал недоступен.");
      const candidate = {
        id: randomUUID(),
        userId: req.session.userId,
        sessionId: req.session.id,
        communityId: channel.communityId,
        channelId,
        room: `hub_voice_${channel.id}`,
        revoked: false,
        createdAt: new Date(),
      };
      if (!(await this.valid(tx, candidate)))
        throw new ForbiddenException("Нет доступа к голосовому каналу.");
      const previous = await tx.voiceLease.findUnique({
        where: { userId: candidate.userId },
      });
      if (previous) await this.remove(previous);
      await this.client.createRoom({
        name: candidate.room,
        emptyTimeout: 60,
        departureTimeout: 15,
        maxParticipants: 20,
      });
      await tx.voiceLease.upsert({
        where: { userId: candidate.userId },
        create: candidate,
        update: candidate,
      });
      const token = new AccessToken(cfg.key, cfg.secret, {
        identity: candidate.userId,
        name: req.session.user.displayName,
        metadata: candidate.id,
        ttl: 60,
      });
      token.addGrant({
        roomJoin: true,
        room: candidate.room,
        canSubscribe: true,
        canPublish: true,
        canPublishSources: [
          TrackSource.MICROPHONE,
          TrackSource.SCREEN_SHARE,
          TrackSource.SCREEN_SHARE_AUDIO,
        ],
        canPublishData: false,
        canUpdateOwnMetadata: false,
      });
      return {
        token: await token.toJwt(),
        leaseId: candidate.id,
        channelId,
        communityId: candidate.communityId,
        channelName: channel.name,
        serverUrl:
          config.env === "production"
            ? "wss://rtc.mrloic.ru/livekit"
            : `${config.origin.replace(/^http/, "ws")}/livekit`,
      };
    });
  }
  async leave(userId: string, sessionId: string, leaseId: string) {
    const lease = await this.db.voiceLease.findUnique({ where: { userId } });
    if (!lease || lease.id !== leaseId || lease.sessionId !== sessionId)
      return { ok: true };
    await this.db.voiceLease.updateMany({
      where: { userId, id: leaseId },
      data: { revoked: true },
    });
    await this.reconcile(userId);
    return { ok: true };
  }
  async authorize(
    req: AuthRequest | undefined,
    rawToken: string,
    socket?: Duplex,
  ) {
    this.enabled();
    const claims = await new TokenVerifier(cfg.key, cfg.secret).verify(
      rawToken,
    );
    const userId = req?.session.userId ?? claims.sub;
    if (!userId) throw new ForbiddenException();
    return this.locked(userId, async (tx) => {
      const lease = await tx.voiceLease.findUnique({
        where: { userId },
      });
      if (
        !lease ||
        claims.sub !== lease.userId ||
        claims.metadata !== lease.id ||
        claims.video?.room !== lease.room ||
        !claims.video.roomJoin ||
        (req && lease.sessionId !== req.session.id) ||
        !(await this.valid(tx, lease))
      )
        throw new ForbiddenException();
      if (socket) {
        const set = this.sockets.get(lease.id) ?? new Set<Duplex>();
        set.add(socket);
        this.sockets.set(lease.id, set);
        socket.once("close", () => {
          set.delete(socket);
          if (!set.size) this.sockets.delete(lease.id);
        });
      }
      return lease;
    });
  }
  async reconcile(userId: string) {
    if (!cfg.enabled) return;
    await this.locked(userId, async (tx) => {
      const lease = await tx.voiceLease.findUnique({ where: { userId } });
      if (lease && !(await this.valid(tx, lease))) {
        await this.remove(lease);
        await tx.voiceLease.delete({ where: { userId } });
      }
    });
  }
  async revokeSession(sessionId: string) {
    if (!cfg.enabled) return;
    const leases = await this.db.voiceLease.findMany({ where: { sessionId } });
    for (const lease of leases) await this.reconcile(lease.userId);
  }
  async reconcileCommunity(communityId: string) {
    if (!cfg.enabled) return;
    for (const lease of await this.db.voiceLease.findMany({
      where: { communityId },
    }))
      await this.reconcile(lease.userId);
    // Deleting the room also disconnects orphaned participants after a crashed API.
    const rooms = await this.client.listRooms();
    for (const room of rooms.filter((r) => r.name.startsWith("hub_voice_"))) {
      const channel = await this.db.channel.findUnique({
        where: { id: room.name.slice(10) },
      });
      if (!channel) await this.client.deleteRoom(room.name);
    }
  }
  private async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      for (const lease of await this.db.voiceLease.findMany())
        await this.reconcile(lease.userId);
      // Sweep room participants too: a crash between removal and commit cannot leave an orphan.
      for (const room of await this.client.listRooms())
        if (room.name.startsWith("hub_voice_")) {
          for (const participant of await this.client.listParticipants(
            room.name,
          )) {
            await this.locked(participant.identity, async (tx) => {
              const lease = await tx.voiceLease.findUnique({
                where: { userId: participant.identity },
              });
              let current;
              try {
                current = await this.client.getParticipant(
                  room.name,
                  participant.identity,
                );
              } catch (error) {
                if (
                  error instanceof Error &&
                  "code" in error &&
                  error.code === "not_found"
                )
                  return;
                throw error;
              }
              if (
                !lease ||
                lease.room !== room.name ||
                lease.id !== current.metadata ||
                !(await this.valid(tx, lease))
              )
                await this.client.removeParticipant(
                  room.name,
                  participant.identity,
                );
            });
          }
        }
    } catch {
      console.error("voice_reconcile_failed");
    } finally {
      this.sweeping = false;
    }
  }
}
