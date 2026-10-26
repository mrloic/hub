import "reflect-metadata";
import { VoiceGateway } from "./voice/voice.gateway";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { SafeErrors } from "./common/errors";
import { Realtime } from "./realtime/realtime.service";
async function main() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: ["error", "warn", "log"],
  });
  const express = app.getHttpAdapter().getInstance();
  express.set("trust proxy", false);
  express.set("json replacer", (_key: string, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  app.get(VoiceGateway).attach(express, app.getHttpServer());
  app.use(helmet());
  app.use(json({ limit: "16kb" }));
  app.use(
    (
      _req: unknown,
      res: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => {
      res.setHeader("Cache-Control", "no-store");
      next();
    },
  );
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new SafeErrors());
  app.enableShutdownHooks();
  app.get(Realtime).attach(app.getHttpServer());
  await app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
}
void main();
