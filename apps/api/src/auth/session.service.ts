import { Injectable, UnauthorizedException } from "@nestjs/common";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { Request, Response } from "express";
import { Database, publicUser } from "../common/database";
import { config } from "../common/config";
export function cookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((v) => v.trim().split("="))
      .filter((v) => v.length === 2),
  );
}
export function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function equal(a: string, b: string) {
  return (
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
const cookieOptions = {
  httpOnly: true,
  secure: config.secure,
  sameSite: "strict" as const,
  path: "/",
};
@Injectable()
export class Sessions {
  constructor(private readonly db: Database) {}
  async fromCookie(header?: string) {
    const token = cookies(header).hub_session;
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw new UnauthorizedException("Войдите в аккаунт.");
    const session = await this.db.session.findUnique({
      where: { id: hashToken(token) },
      include: { user: { select: publicUser } },
    });
    if (!session || session.expiresAt.getTime() <= Date.now())
      throw new UnauthorizedException("Сессия истекла. Войдите снова.");
    return session;
  }
  async create(userId: string, req: Request, res: Response) {
    const previous = cookies(req.headers.cookie).hub_session;
    if (previous)
      await this.db.session.deleteMany({ where: { id: hashToken(previous) } });
    const token = randomBytes(32).toString("hex");
    await this.db.session.create({
      data: {
        id: hashToken(token),
        userId,
        expiresAt: new Date(Date.now() + config.sessionMs),
      },
    });
    res.cookie("hub_session", token, {
      ...cookieOptions,
      maxAge: config.sessionMs,
    });
  }
  async revoke(req: Request, res: Response) {
    const token = cookies(req.headers.cookie).hub_session;
    if (token)
      await this.db.session.deleteMany({ where: { id: hashToken(token) } });
    res.clearCookie("hub_session", cookieOptions);
    return token ? hashToken(token) : "";
  }
  csrf(res: Response) {
    const value = `${Date.now()}.${randomBytes(24).toString("hex")}`;
    const token = `${value}.${createHmac("sha256", config.secret).update(value).digest("hex")}`;
    res.cookie("hub_csrf", token, {
      ...cookieOptions,
      maxAge: config.sessionMs,
    });
    return { csrf: token };
  }
  verifyCsrf(req: Request) {
    const token = req.get("x-hub-csrf") ?? "";
    const stored = cookies(req.headers.cookie).hub_csrf ?? "";
    const [stamp, nonce, signature] = token.split(".");
    const age = Date.now() - Number(stamp);
    return (
      req.get("origin") === config.origin &&
      token.length < 200 &&
      equal(token, stored) &&
      age >= 0 &&
      age < config.sessionMs &&
      !!nonce &&
      !!signature &&
      equal(
        signature,
        createHmac("sha256", config.secret)
          .update(`${stamp}.${nonce}`)
          .digest("hex"),
      )
    );
  }
}
export type AuthRequest = Request & {
  session: Awaited<ReturnType<Sessions["fromCookie"]>>;
};
