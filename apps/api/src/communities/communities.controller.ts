import { canAssignRole } from "../../../../packages/shared/src";
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import {
  canKick,
  id,
  name,
  channelInput,
} from "../../../../packages/shared/src";
import { Database, publicUser } from "../common/database";
import type { AuthRequest } from "../auth/session.service";
import { Access } from "./access.service";
import { Realtime } from "../realtime/realtime.service";
const named = z.object({ name }).strict();
@Controller("communities")
export class CommunitiesController {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly realtime: Realtime,
  ) {}
  @Get() async list(@Req() req: AuthRequest) {
    return (
      await this.db.membership.findMany({
        where: { userId: req.session.userId },
        include: { community: true },
        orderBy: { community: { createdAt: "asc" } },
      })
    ).map((m) => ({ ...m.community, role: m.role }));
  }
  @Post() async create(@Req() req: AuthRequest, @Body() body: unknown) {
    const data = named.parse(body);
    const community = await this.db.community.create({
      data: {
        ...data,
        memberships: { create: { userId: req.session.userId, role: "OWNER" } },
        channels: { create: { name: "общий" } },
      },
    });
    await this.realtime.user(req.session.userId);
    return community;
  }
  @Get(":cid") detail(@Req() req: AuthRequest, @Param("cid") cid: string) {
    return this.access.inCommunity(
      id.parse(cid),
      req.session.userId,
      async (tx, role) => ({
        ...(await tx.community.findUniqueOrThrow({ where: { id: cid } })),
        role,
        channels: await tx.channel.findMany({
          where: { communityId: cid },
          orderBy: { createdAt: "asc" },
        }),
        members: await tx.membership.findMany({
          where: { communityId: cid },
          include: { user: { select: publicUser } },
          orderBy: { user: { username: "asc" } },
        }),
      }),
    );
  }
  @Patch(":cid") async rename(
    @Req() req: AuthRequest,
    @Param("cid") cid: string,
    @Body() body: unknown,
  ) {
    const data = named.parse(body);
    const result = await this.access.inCommunity(
      id.parse(cid),
      req.session.userId,
      async (tx, role) => {
        this.access.manager(role);
        return tx.community.update({ where: { id: cid }, data });
      },
    );
    await this.realtime.accessChanged(cid);
    return result;
  }
  @Delete(":cid") async remove(
    @Req() req: AuthRequest,
    @Param("cid") cid: string,
  ) {
    const members = await this.access.inCommunity(
      id.parse(cid),
      req.session.userId,
      async (tx, role) => {
        this.access.owner(role);
        const members = await tx.membership.findMany({
          where: { communityId: cid },
        });
        await tx.community.delete({ where: { id: cid } });
        return members;
      },
    );
    await this.realtime.accessChanged(
      cid,
      members.map((m) => m.userId),
    );
    return { ok: true };
  }
  @Post(":cid/leave") async leave(
    @Req() req: AuthRequest,
    @Param("cid") cid: string,
  ) {
    await this.access.inCommunity(
      id.parse(cid),
      req.session.userId,
      async (tx, role) => {
        if (role === "OWNER")
          throw new ForbiddenException(
            "Сначала передайте владение или удалите сообщество.",
          );
        await tx.membership.delete({
          where: {
            communityId_userId: {
              communityId: cid,
              userId: req.session.userId,
            },
          },
        });
      },
    );
    await this.realtime.accessChanged(cid, [req.session.userId]);
    return { ok: true };
  }
  @Patch(":cid/members/:uid") async role(
    @Req() req: AuthRequest,
    @Param("cid") cid: string,
    @Param("uid") uid: string,
    @Body() body: unknown,
  ) {
    const data = z
      .object({ role: z.enum(["CO_OWNER", "ADMIN", "MEMBER"]) })
      .strict()
      .parse(body);
    id.parse(uid);
    await this.access.inCommunity(
      id.parse(cid),
      req.session.userId,
      async (tx, role) => {
        const target = await tx.membership.findUnique({
          where: { communityId_userId: { communityId: cid, userId: uid } },
        });
        if (
          !target ||
          uid === req.session.userId ||
          !canAssignRole(role, target.role, data.role)
        )
          throw new ForbiddenException("Эту роль изменить нельзя.");
        await tx.membership.update({
          where: { communityId_userId: { communityId: cid, userId: uid } },
          data,
        });
      },
    );
    await this.realtime.accessChanged(cid);
    return { ok: true };
  }
  @Delete(":cid/members/:uid") async kick(
    @Req() req: AuthRequest,
    @Param("cid") cid: string,
    @Param("uid") uid: string,
  ) {
    id.parse(uid);
    await this.access.inCommunity(
      id.parse(cid),
      req.session.userId,
      async (tx, role) => {
        const target = await tx.membership.findUnique({
          where: { communityId_userId: { communityId: cid, userId: uid } },
        });
        if (
          !target ||
          !canKick(role, target.role) ||
          uid === req.session.userId
        )
          throw new ForbiddenException("Нельзя исключить этого участника.");
        await tx.membership.delete({
          where: { communityId_userId: { communityId: cid, userId: uid } },
        });
      },
    );
    await this.realtime.accessChanged(cid, [uid]);
    return { ok: true };
  }
  @Post(":cid/transfer") async transfer(
    @Req() req: AuthRequest,
    @Param("cid") cid: string,
    @Body() body: unknown,
  ) {
    const { userId } = z.object({ userId: id }).strict().parse(body);
    await this.access.inCommunity(
      id.parse(cid),
      req.session.userId,
      async (tx, role) => {
        this.access.owner(role);
        if (
          userId === req.session.userId ||
          !(await tx.membership.findUnique({
            where: { communityId_userId: { communityId: cid, userId } },
          }))
        )
          throw new ForbiddenException("Выберите другого участника.");
        await tx.membership.update({
          where: {
            communityId_userId: {
              communityId: cid,
              userId: req.session.userId,
            },
          },
          data: { role: "ADMIN" },
        });
        await tx.membership.update({
          where: { communityId_userId: { communityId: cid, userId } },
          data: { role: "OWNER" },
        });
      },
    );
    await this.realtime.accessChanged(cid);
    return { ok: true };
  }
  @Post(":cid/channels") async channel(
    @Req() req: AuthRequest,
    @Param("cid") cid: string,
    @Body() body: unknown,
  ) {
    const data = channelInput.parse(body);
    const result = await this.access.inCommunity(
      id.parse(cid),
      req.session.userId,
      async (tx, role) => {
        this.access.manager(role);
        return tx.channel.create({ data: { ...data, communityId: cid } });
      },
    );
    await this.realtime.accessChanged(cid);
    return result;
  }
  @Patch(":cid/channels/:chid") async renameChannel(
    @Req() req: AuthRequest,
    @Param("cid") cid: string,
    @Param("chid") chid: string,
    @Body() body: unknown,
  ) {
    const data = named.parse(body);
    id.parse(chid);
    await this.access.inCommunity(
      id.parse(cid),
      req.session.userId,
      async (tx, role) => {
        this.access.manager(role);
        const result = await tx.channel.updateMany({
          where: { id: chid, communityId: cid },
          data,
        });
        if (!result.count) throw new NotFoundException("Канал не найден.");
      },
    );
    await this.realtime.accessChanged(cid);
    return { ok: true };
  }
  @Delete(":cid/channels/:chid") async deleteChannel(
    @Req() req: AuthRequest,
    @Param("cid") cid: string,
    @Param("chid") chid: string,
  ) {
    id.parse(chid);
    await this.access.inCommunity(
      id.parse(cid),
      req.session.userId,
      async (tx, role) => {
        this.access.manager(role);
        const result = await tx.channel.deleteMany({
          where: { id: chid, communityId: cid },
        });
        if (!result.count) throw new NotFoundException("Канал не найден.");
      },
    );
    await this.realtime.accessChanged(cid);
    return { ok: true };
  }
}
