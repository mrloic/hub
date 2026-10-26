import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import {
  canDeleteMessage,
  id,
  messageInput,
} from "../../../../packages/shared/src";
import { publicUser } from "../common/database";
import type { AuthRequest } from "../auth/session.service";
import { Access } from "../communities/access.service";
import { Realtime } from "../realtime/realtime.service";
import { RateLimiter } from "../common/rate-limit";
const include = { author: { select: publicUser } };
@Controller("channels/:chid/messages")
export class ChatController {
  constructor(
    private readonly access: Access,
    private readonly realtime: Realtime,
    private readonly rate: RateLimiter,
  ) {}
  @Get() history(
    @Req() req: AuthRequest,
    @Param("chid") chid: string,
    @Query() query: unknown,
  ) {
    const { before } = z
      .object({
        before: z
          .string()
          .regex(/^[1-9][0-9]{0,18}$/)
          .refine((value) => BigInt(value) <= 9223372036854775807n)
          .optional(),
      })
      .strict()
      .parse(query);
    return this.access.channel(
      id.parse(chid),
      req.session.userId,
      async (tx) => {
        const items = await tx.message.findMany({
          where: {
            channelId: chid,
            ...(before ? { sequence: { lt: BigInt(before) } } : {}),
          },
          orderBy: { sequence: "desc" },
          take: 51,
          include,
        });
        const hasMore = items.length > 50;
        const page = items.slice(0, 50);
        return {
          items: page.reverse(),
          next: hasMore ? page[0].sequence.toString() : null,
        };
      },
    );
  }
  @Post() async send(
    @Req() req: AuthRequest,
    @Param("chid") chid: string,
    @Body() body: unknown,
  ) {
    const data = messageInput.parse(body);
    await this.rate.hit("message", req.session.userId, 60);
    const result = await this.access.channel(
      id.parse(chid),
      req.session.userId,
      async (tx, _role, communityId) => {
        const old = await tx.message.findUnique({
          where: {
            authorId_clientId: {
              authorId: req.session.userId,
              clientId: data.clientId,
            },
          },
          include,
        });
        if (old && old.channelId !== chid)
          throw new ConflictException(
            "Идентификатор отправки уже использован.",
          );
        const message =
          old ??
          (await tx.message.create({
            data: { ...data, channelId: chid, authorId: req.session.userId },
            include,
          }));
        return { message, communityId };
      },
    );
    await this.realtime.community(result.communityId);
    return result.message;
  }
  @Patch(":mid") async edit(
    @Req() req: AuthRequest,
    @Param("chid") chid: string,
    @Param("mid") mid: string,
    @Body() body: unknown,
  ) {
    const data = z
      .object({ content: messageInput.shape.content })
      .strict()
      .parse(body);
    id.parse(mid);
    await this.rate.hit("message", req.session.userId, 60);
    const cid = await this.access.channel(
      id.parse(chid),
      req.session.userId,
      async (tx, _role, communityId) => {
        const message = await tx.message.findFirst({
          where: { id: mid, channelId: chid, deletedAt: null },
        });
        if (!message) throw new NotFoundException("Сообщение недоступно.");
        if (message.authorId !== req.session.userId)
          throw new ForbiddenException(
            "Можно редактировать только свои сообщения.",
          );
        await tx.message.update({
          where: { id: mid },
          data: { ...data, editedAt: new Date() },
        });
        return communityId;
      },
    );
    await this.realtime.community(cid);
    return { ok: true };
  }
  @Delete(":mid") async remove(
    @Req() req: AuthRequest,
    @Param("chid") chid: string,
    @Param("mid") mid: string,
  ) {
    id.parse(mid);
    const cid = await this.access.channel(
      id.parse(chid),
      req.session.userId,
      async (tx, role, communityId) => {
        const message = await tx.message.findFirst({
          where: { id: mid, channelId: chid },
        });
        if (!message) throw new NotFoundException("Сообщение недоступно.");
        const author = await tx.membership.findUnique({
          where: {
            communityId_userId: { communityId, userId: message.authorId },
          },
        });
        if (
          !canDeleteMessage(
            role,
            author?.role ?? "MEMBER",
            message.authorId === req.session.userId,
          )
        )
          throw new ForbiddenException("Недостаточно прав для удаления.");
        await tx.message.update({
          where: { id: mid },
          data: { content: "", deletedAt: new Date() },
        });
        return communityId;
      },
    );
    await this.realtime.community(cid);
    return { ok: true };
  }
}
