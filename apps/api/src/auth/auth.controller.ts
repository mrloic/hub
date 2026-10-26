import { clientAddress } from "../common/client-address";
import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Response } from "express";
import { hash, verify, argon2id } from "argon2";
import { z } from "zod";
import {
  credentials,
  registration,
  displayName,
} from "../../../../packages/shared/src";
import { Database, publicUser } from "../common/database";
import { RateLimiter } from "../common/rate-limit";
import { Public } from "./auth.guard";
import { Sessions, type AuthRequest } from "./session.service";
import { Realtime } from "../realtime/realtime.service";
@Controller("auth")
export class AuthController {
  constructor(
    private readonly db: Database,
    private readonly sessions: Sessions,
    private readonly rate: RateLimiter,
    private readonly realtime: Realtime,
  ) {}
  @Public() @Get("csrf") csrf(@Res({ passthrough: true }) res: Response) {
    return this.sessions.csrf(res);
  }
  @Get("me") me(@Req() req: AuthRequest) {
    return req.session.user;
  }
  @Public() @Post("register") async register(
    @Body() body: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.rate.hit("register", clientAddress(req), 20, 3600);
    const data = registration.parse(body);
    const user = await this.db.user.create({
      data: {
        username: data.username,
        displayName: data.displayName,
        passwordHash: await hash(data.password, {
          type: argon2id,
          memoryCost: 65536,
          timeCost: 3,
          parallelism: 1,
        }),
      },
      select: publicUser,
    });
    const old = await this.sessions.revoke(req, res);
    await this.realtime.revokeSession(old);
    await this.sessions.create(user.id, req, res);
    return user;
  }
  @Public() @Post("login") async login(
    @Body() body: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.rate.hit("login-ip", clientAddress(req), 60, 60);
    const data = credentials.parse(body);
    await this.rate.hit("login-name", data.username, 10, 300);
    const user = await this.db.user.findUnique({
      where: { username: data.username },
    });
    // Equal-cost fallback prevents a cheap username existence timing oracle.
    const valid = user
      ? await verify(user.passwordHash, data.password)
      : (await hash(data.password, {
          type: argon2id,
          memoryCost: 65536,
          timeCost: 3,
          parallelism: 1,
        }),
        false);
    if (!user || !valid)
      throw new UnauthorizedException("Неверный логин или пароль.");
    const old = await this.sessions.revoke(req, res);
    await this.realtime.revokeSession(old);
    await this.sessions.create(user.id, req, res);
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    };
  }
  @Post("logout") async logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.realtime.revokeSession(await this.sessions.revoke(req, res));
    return { ok: true };
  }
  @Patch("profile") async profile(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const data = z.object({ displayName }).strict().parse(body);
    const user = await this.db.user.update({
      where: { id: req.session.userId },
      data,
      select: publicUser,
    });
    const memberships = await this.db.membership.findMany({
      where: { userId: user.id },
    });
    for (const m of memberships) await this.realtime.community(m.communityId);
    return user;
  }
}
