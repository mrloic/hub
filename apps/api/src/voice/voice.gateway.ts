import { Injectable } from "@nestjs/common";
import type { Socket } from "node:net";
import type { Express, Request, Response, NextFunction } from "express";
import type { Server, IncomingMessage } from "node:http";
import { createProxyMiddleware } from "http-proxy-middleware";
import { config } from "../common/config";
import { Sessions, type AuthRequest } from "../auth/session.service";
import { VoiceService } from "./voice.service";
import { voiceConfig } from "./voice.config";
@Injectable()
export class VoiceGateway {
  constructor(
    private readonly sessions: Sessions,
    private readonly voice: VoiceService,
  ) {}
  attach(app: Express, server: Server) {
    const proxy = createProxyMiddleware({
      target: voiceConfig.url,
      changeOrigin: true,
      ws: false,
      pathRewrite: { "^/livekit": "" },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      on: {
        error: (_error, _req, res) => {
          if ("writeHead" in res) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end('{"message":"Медиасервер недоступен."}');
          } else res.destroy();
        },
      },
    });
    const parse = (req: IncomingMessage) => {
      const url = new URL(req.url ?? "/", config.origin);
      if (
        ![
          "/livekit/rtc",
          "/livekit/rtc/v1",
          "/livekit/rtc/validate",
          "/livekit/rtc/v1/validate",
        ].includes(url.pathname)
      )
        throw new Error("Invalid signaling path");
      const token = url.searchParams.get("access_token") ?? "";
      if (!token || token.length > 8192) throw new Error("Invalid token");
      return token;
    };
    app.use(async (req: Request, res: Response, next: NextFunction) => {
      if (!req.path.startsWith("/livekit")) return next();
      try {
        if (
          req.method !== "GET" ||
          (req.headers.origin && req.headers.origin !== config.origin)
        )
          throw new Error();
        const token = parse(req);
        if (config.env === "production") {
          if (req.headers.origin !== config.origin) throw new Error();
          res.setHeader("Access-Control-Allow-Origin", config.origin);
          res.setHeader("Vary", "Origin");
          await this.voice.authorize(undefined, token);
        } else {
          const session = await this.sessions.fromCookie(req.headers.cookie);
          await this.voice.authorize(Object.assign(req, { session }), token);
        }
        await proxy(req, res, next);
      } catch {
        res.status(403).json({ message: "Голосовой доступ недействителен." });
      }
    });
    server.on("upgrade", (req, socket, head) => {
      if (!req.url?.startsWith("/livekit")) return;
      void (async () => {
        try {
          if (req.headers.origin !== config.origin) throw new Error();
          const token = parse(req);
          const request =
            config.env === "production"
              ? undefined
              : (Object.assign(req, {
                  session: await this.sessions.fromCookie(req.headers.cookie),
                }) as AuthRequest);
          await this.voice.authorize(request, token, socket);
          if (!socket.destroyed) proxy.upgrade!(req, socket as Socket, head);
        } catch {
          socket.end(
            "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
          );
        }
      })();
    });
  }
}
