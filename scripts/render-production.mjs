import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";
import { isIPv4, BlockList } from "node:net";
const env = parseEnv(readFileSync(".env.production", "utf8"));
if (!isIPv4(env.PUBLIC_IPV4 ?? ""))
  throw new Error(
    "Задайте PUBLIC_IPV4 в локальном .env.production; значение не выводится.",
  );
const nonPublic = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
])
  nonPublic.addSubnet(address, prefix, "ipv4");
if (nonPublic.check(env.PUBLIC_IPV4, "ipv4"))
  throw new Error(
    "Production требует публичный IPv4, не локальный/тестовый адрес.",
  );
if (
  env.APP_ENV !== "production" ||
  env.APP_URL !== "https://hub.mrloic.ru" ||
  env.VOICE_ENABLED !== "true"
)
  throw new Error("Некорректный режим production.");
for (const [key, min] of [
  ["APP_SECRET", 48],
  ["PROXY_SECRET", 48],
  ["LIVEKIT_API_SECRET", 32],
  ["LIVEKIT_API_KEY", 8],
  ["POSTGRES_PASSWORD", 16],
])
  if (!env[key] || env[key].length < min || !/^[a-zA-Z0-9_-]+$/.test(env[key]))
    throw new Error(`Проверьте ${key}; значение не выводится.`);
mkdirSync(".runtime/production", { recursive: true, mode: 0o700 });
writeFileSync(
  ".runtime/production/livekit.yaml",
  readFileSync("infra/livekit.production.yaml", "utf8").replaceAll(
    "<PUBLIC_IPV4>",
    env.PUBLIC_IPV4,
  ),
  { mode: 0o644 },
);
console.log(
  "Конфигурация LiveKit подготовлена в .runtime/production. Сервисы не запущены.",
);
