import { VoiceService } from "../voice/voice.service";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import { Database } from "../common/database";
import { Sessions } from "../auth/session.service";
import { config } from "../common/config";
import { RateLimiter } from "../common/rate-limit";
@Injectable()
export class Realtime implements OnModuleDestroy {
  private io?: Server;
  private timer?: NodeJS.Timeout;
  constructor(
    private readonly db: Database,
    private readonly sessions: Sessions,
    private readonly rate: RateLimiter,
    private readonly voice: VoiceService,
  ) {}
  attach(server: HttpServer) {
    this.io = new Server(server, {
      maxHttpBufferSize: 8192,
      serveClient: false,
      cors: { origin: config.origin, credentials: true },
      allowRequest: (req, done) =>
        done(null, req.headers.origin === config.origin),
    });
    this.io.use(async (socket, next) => {
      try {
        const session = await this.sessions.fromCookie(
          socket.handshake.headers.cookie,
        );
        socket.data.session = session;
        next();
      } catch {
        next(new Error("Сессия недействительна"));
      }
    });
    this.io.on("connection", (socket) => {
      const expire = setTimeout(
        () => socket.disconnect(true),
        Math.max(1, socket.data.session.expiresAt.getTime() - Date.now()),
      );
      socket.on("disconnect", () => clearTimeout(expire));
      socket.on("subscribe", async (payload: unknown, ack: unknown) => {
        if (typeof ack !== "function") return;
        try {
          const session = await this.sessions.fromCookie(
            socket.handshake.headers.cookie,
          );
          await this.rate.hit("subscribe", session.userId, 120);
          const { communityId, channelId } = z
            .object({
              communityId: z.string().uuid(),
              channelId: z.string().uuid().optional(),
            })
            .strict()
            .parse(payload);
          const member = await this.db.membership.findUnique({
            where: {
              communityId_userId: { communityId, userId: session.userId },
            },
          });
          if (
            !member ||
            (channelId &&
              !(await this.db.channel.findFirst({
                where: { id: channelId, communityId },
              })))
          )
            return ack({ ok: false });
          socket.data.communityId = communityId;
          socket.data.channelId = channelId;
          ack({ ok: true });
        } catch {
          ack({ ok: false });
        }
      });
    });
    this.timer = setInterval(() => {
      void this.sweep();
    }, 15000);
  }
  private async sweep() {
    try {
      if (this.io)
        for (const socket of this.io.sockets.sockets.values()) {
          try {
            await this.sessions.fromCookie(socket.handshake.headers.cookie);
          } catch {
            socket.disconnect(true);
          }
        }
      await this.db.session.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      await this.db.rateLimit.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
    } catch {
      console.error("session_sweep_failed");
    }
  }
  async revokeSession(id: string) {
    try {
      await this.voice.revokeSession(id);
    } catch {
      console.error("voice_revoke_pending");
    }
    if (this.io)
      for (const socket of this.io.sockets.sockets.values())
        if (socket.data.session.id === id) socket.disconnect(true);
  }
  async user(userId: string) {
    if (!this.io) return;
    for (const socket of this.io.sockets.sockets.values())
      if (socket.data.session.userId === userId) {
        try {
          await this.sessions.fromCookie(socket.handshake.headers.cookie);
          delete socket.data.communityId;
          delete socket.data.channelId;
          socket.emit("refresh");
        } catch {
          socket.disconnect(true);
        }
      }
  }
  async accessChanged(communityId: string, removedUsers: string[] = []) {
    try {
      await this.voice.reconcileCommunity(communityId);
    } catch {
      console.error("voice_revoke_pending");
    }
    await this.community(communityId, removedUsers);
  }
  async community(communityId: string, removedUsers: string[] = []) {
    const members = await this.db.membership.findMany({
      where: { communityId },
      select: { userId: true },
    });
    for (const userId of new Set([
      ...members.map((m) => m.userId),
      ...removedUsers,
    ]))
      await this.user(userId);
  }
  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.io?.close();
  }
}
