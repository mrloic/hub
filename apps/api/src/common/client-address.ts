import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Request } from "express";
import { config } from "./config";

// Only Caddy knows this credential. Never trust client X-Forwarded-* headers.
export function clientAddress(
  req: Request,
  env = config.env,
  secret = config.proxySecret,
) {
  const provided = req.headers["x-hub-proxy"];
  const address = req.headers["x-hub-client-ip"];
  if (
    env === "production" &&
    typeof provided === "string" &&
    secret.length >= 48 &&
    Buffer.byteLength(provided) === Buffer.byteLength(secret) &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(secret)) &&
    typeof address === "string" &&
    isIP(address)
  )
    return address;
  return req.socket.remoteAddress ?? "";
}
