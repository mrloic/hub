import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
if (existsSync(".env.production")) {
  console.log(".env.production уже существует; сохранён без изменений.");
} else {
  const local = parseEnv(readFileSync(".env", "utf8"));
  for (const key of [
    "POSTGRES_PASSWORD",
    "APP_SECRET",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
  ])
    if (!local[key] || !/^[a-zA-Z0-9_-]+$/.test(local[key]))
      throw new Error(
        `Проверьте наличие и формат ${key} в .env; файл не создан.`,
      );
  const content = [
    "APP_NAME=Hub",
    "APP_ENV=production",
    "APP_URL=https://hub.mrloic.ru",
    "VOICE_ENABLED=true",
    "PUBLIC_IPV4=<PUBLIC_IPV4>",
    "POSTGRES_VOLUME=hub_postgres-data",
    ...[
      "POSTGRES_PASSWORD",
      "APP_SECRET",
      "LIVEKIT_API_KEY",
      "LIVEKIT_API_SECRET",
    ].map((key) => `${key}=${local[key]}`),
    `PROXY_SECRET=${randomBytes(48).toString("hex")}`,
    "",
  ].join("\n");
  writeFileSync(".env.production", content, { flag: "wx", mode: 0o600 });
  console.log(
    "Создан закрытый .env.production; секреты сохранены. Заполните PUBLIC_IPV4 локально, затем выполните render-production.mjs.",
  );
}
