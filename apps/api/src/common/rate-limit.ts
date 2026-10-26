import { HttpException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Database } from "./database";
@Injectable()
export class RateLimiter {
  constructor(private readonly db: Database) {}
  async hit(scope: string, key: string, limit: number, seconds = 60) {
    const now = Date.now();
    const bucket = Math.floor(now / (seconds * 1000));
    const hash = createHash("sha256")
      .update(`${scope}:${key}:${bucket}`)
      .digest("hex");
    const row = await this.db.rateLimit.upsert({
      where: { key: hash },
      create: {
        key: hash,
        count: 1,
        expiresAt: new Date((bucket + 1) * seconds * 1000),
      },
      update: { count: { increment: 1 } },
    });
    if (row.count > limit)
      throw new HttpException(
        "Слишком много запросов. Подождите немного.",
        429,
      );
  }
}
