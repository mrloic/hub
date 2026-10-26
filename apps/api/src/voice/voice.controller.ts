import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import {
  voiceJoinInput,
  voiceLeaveInput,
} from "../../../../packages/shared/src";
import type { AuthRequest } from "../auth/session.service";
import { RateLimiter } from "../common/rate-limit";
import { VoiceService } from "./voice.service";
import { voiceConfig } from "./voice.config";
@Controller("voice")
export class VoiceController {
  constructor(
    private readonly voice: VoiceService,
    private readonly rate: RateLimiter,
  ) {}
  @Get("config") config() {
    return { enabled: voiceConfig.enabled };
  }
  @Post("join") async join(@Req() req: AuthRequest, @Body() body: unknown) {
    const { channelId } = voiceJoinInput.parse(body);
    await this.rate.hit("voice-join", req.session.userId, 20);
    return this.voice.join(req, channelId);
  }
  @Post("leave") leave(@Req() req: AuthRequest, @Body() body: unknown) {
    const { leaseId } = voiceLeaveInput.parse(body);
    return this.voice.leave(req.session.userId, req.session.id, leaseId);
  }
}
