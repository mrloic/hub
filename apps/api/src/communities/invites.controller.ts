import {
  Body,
  Controller,
  Delete,
  Get,
  GoneException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { id, inviteInput } from "../../../../packages/shared/src";
import { Database } from "../common/database";
import { config } from "../common/config";
import { RateLimiter } from "../common/rate-limit";
import type { AuthRequest } from "../auth/session.service";
import { Access } from "./access.service";
import { Realtime } from "../realtime/realtime.service";
@Controller()
export class InvitesController {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly realtime: Realtime,
    private readonly rate: RateLimiter,
  ) {}
  @Get("communities/:cid/invites") list(
    @Req() req: AuthRequest,
    @Param("cid") cid: string,
  ) {
    return this.access.inCommunity(
      id.parse(cid),
      req.session.userId,
      async (tx, role) => {
        this.access.manager(role);
        return (
          await tx.invite.findMany({
            where: { communityId: cid },
            orderBy: { createdAt: "desc" },
            take: 100,
          })
        ).map((i) => ({
          ...i,
          token: undefined,
          url: `${config.origin}/invite/${i.token}`,
        }));
      },
    );
  }
  @Post("communities/:cid/invites") async create(
    @Req() req: AuthRequest,
    @Param("cid") cid: string,
    @Body() body: unknown,
  ) {
    const data = inviteInput.parse(body);
    await this.rate.hit("invite-create", req.session.userId, 20);
    return this.access.inCommunity(
      id.parse(cid),
      req.session.userId,
      async (tx, role) => {
        this.access.manager(role);
        const i = await tx.invite.create({
          data: {
            communityId: cid,
            token: randomBytes(32).toString("hex"),
            maxUses: data.maxUses,
            expiresAt: new Date(Date.now() + data.hours * 3600_000),
          },
        });
        return {
          ...i,
          token: undefined,
          url: `${config.origin}/invite/${i.token}`,
        };
      },
    );
  }
  @Delete("communities/:cid/invites/:iid") async revoke(
    @Req() req: AuthRequest,
    @Param("cid") cid: string,
    @Param("iid") iid: string,
  ) {
    id.parse(iid);
    await this.access.inCommunity(
      id.parse(cid),
      req.session.userId,
      async (tx, role) => {
        this.access.manager(role);
        await tx.invite.updateMany({
          where: { id: iid, communityId: cid },
          data: { revokedAt: new Date() },
        });
      },
    );
    return { ok: true };
  }
  @Post("invites/join") async join(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    await this.rate.hit("invite-join", req.session.userId, 30);
    const { token } = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(body);
    const found = await this.db.invite.findUnique({ where: { token } });
    if (!found) throw new GoneException("Приглашение недоступно.");
    const result = await this.db.$transaction(async (tx) => {
      // Same community-first lock order as management operations. Recheck after locking.
      await tx.$queryRaw`SELECT id FROM "Community" WHERE id = ${found.communityId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Invite" WHERE id = ${found.id} FOR UPDATE`;
      const invite = await tx.invite.findUnique({ where: { id: found.id } });
      if (!invite) throw new GoneException("Приглашение недоступно.");
      const existing = await tx.membership.findUnique({
        where: {
          communityId_userId: {
            communityId: invite.communityId,
            userId: req.session.userId,
          },
        },
      });
      if (existing)
        return { communityId: invite.communityId, alreadyMember: true };
      if (
        invite.revokedAt ||
        invite.expiresAt.getTime() <= Date.now() ||
        invite.uses >= invite.maxUses
      )
        throw new GoneException(
          "Приглашение отозвано, истекло или исчерпало лимит.",
        );
      await tx.membership.create({
        data: { communityId: invite.communityId, userId: req.session.userId },
      });
      await tx.invite.update({
        where: { id: invite.id },
        data: { uses: { increment: 1 } },
      });
      return { communityId: invite.communityId, alreadyMember: false };
    });
    await this.realtime.community(result.communityId);
    return result;
  }
}
