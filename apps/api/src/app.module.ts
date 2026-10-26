import { VoiceService } from "./voice/voice.service";
import { VoiceGateway } from "./voice/voice.gateway";
import { VoiceController } from "./voice/voice.controller";
import { Controller, Get, Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Database } from "./common/database";
import { RateLimiter } from "./common/rate-limit";
import { Sessions } from "./auth/session.service";
import { AuthGuard, Public } from "./auth/auth.guard";
import { AuthController } from "./auth/auth.controller";
import { Realtime } from "./realtime/realtime.service";
import { Access } from "./communities/access.service";
import { CommunitiesController } from "./communities/communities.controller";
import { InvitesController } from "./communities/invites.controller";
import { ChatController } from "./chat/chat.controller";
@Global()
@Module({
  providers: [
    Database,
    Sessions,
    RateLimiter,
    Realtime,
    Access,
    VoiceService,
    VoiceGateway,
  ],
  exports: [
    Database,
    Sessions,
    RateLimiter,
    Realtime,
    Access,
    VoiceService,
    VoiceGateway,
  ],
})
class CoreModule {}
@Module({ controllers: [AuthController] })
class AccountsModule {}
@Module({ controllers: [CommunitiesController, InvitesController] })
class CommunitiesModule {}
@Module({ controllers: [ChatController] })
class ChatModule {}
@Controller()
class HealthController {
  constructor(private readonly db: Database) {}
  @Public() @Get("health") async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}
@Module({
  imports: [CoreModule, AccountsModule, CommunitiesModule, ChatModule],
  controllers: [HealthController, VoiceController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
