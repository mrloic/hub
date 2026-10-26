import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Database } from "../common/database";
import { canManage, type Role } from "../../../../packages/shared/src";
export type Tx = Prisma.TransactionClient;
@Injectable()
export class Access {
  constructor(private readonly db: Database) {}
  async inCommunity<T>(
    communityId: string,
    userId: string,
    action: (tx: Tx, role: Role) => Promise<T>,
  ) {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "Community" WHERE id = ${communityId} FOR UPDATE`;
      if (!rows.length) throw new NotFoundException("Сообщество недоступно.");
      const membership = await tx.membership.findUnique({
        where: { communityId_userId: { communityId, userId } },
      });
      if (!membership)
        throw new ForbiddenException("Нет доступа к сообществу.");
      return action(tx, membership.role);
    });
  }
  manager(role: Role) {
    if (!canManage(role)) throw new ForbiddenException("Недостаточно прав.");
  }
  owner(role: Role) {
    if (role !== "OWNER")
      throw new ForbiddenException("Требуются права владельца.");
  }
  async channel<T>(
    channelId: string,
    userId: string,
    action: (tx: Tx, role: Role, communityId: string) => Promise<T>,
  ) {
    const channel = await this.db.channel.findUnique({
      where: { id: channelId },
    });
    if (!channel) throw new NotFoundException("Канал недоступен.");
    if (channel.type !== "TEXT")
      throw new ForbiddenException(
        "Для этого канала доступно только голосовое общение.",
      );
    return this.inCommunity(channel.communityId, userId, async (tx, role) => {
      if (!(await tx.channel.findUnique({ where: { id: channelId } })))
        throw new NotFoundException("Канал недоступен.");
      return action(tx, role, channel.communityId);
    });
  }
}
