export function readConfig() {
  const env = process.env.APP_ENV ?? "local";
  if (!["local", "test", "production"].includes(env))
    throw new Error("Некорректный APP_ENV");
  const url = new URL(process.env.APP_URL ?? "http://localhost:8080");
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("APP_URL должен быть origin");
  if (env === "production" && url.protocol !== "https:")
    throw new Error("Публичный режим требует HTTPS");
  if (
    env !== "production" &&
    !["localhost", "127.0.0.1", "web"].includes(url.hostname)
  )
    throw new Error("Локальный режим требует локальный APP_URL");
  if (env !== "production" && url.protocol !== "http:")
    throw new Error("Локальный режим требует HTTP");
  const secret = process.env.APP_SECRET ?? "";
  if (secret.length < 48)
    throw new Error("APP_SECRET должен содержать минимум 48 символов");
  if (!process.env.DATABASE_URL) throw new Error("Требуется DATABASE_URL");
  const proxySecret = process.env.PROXY_SECRET ?? "";
  if (env === "production" && proxySecret.length < 48)
    throw new Error("PROXY_SECRET должен содержать минимум 48 символов");
  if (env === "production" && url.origin !== "https://hub.mrloic.ru")
    throw new Error("Production APP_URL должен быть https://hub.mrloic.ru");
  return {
    proxySecret,
    env,
    origin: url.origin,
    secret,
    secure: env === "production",
    sessionMs: 7 * 24 * 3600_000,
  };
}
export const config = readConfig();
