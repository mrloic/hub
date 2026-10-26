import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthRequest, Sessions } from "./session.service";
export const Public = () => SetMetadata("public", true);
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: Sessions,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !this.sessions.verifyCsrf(req)
    )
      throw new ForbiddenException(
        "Не удалось проверить запрос. Обновите страницу.",
      );
    if (
      !this.reflector.getAllAndOverride("public", [
        ctx.getHandler(),
        ctx.getClass(),
      ])
    )
      req.session = await this.sessions.fromCookie(req.headers.cookie);
    return true;
  }
}
