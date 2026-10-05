import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/**
 * Optional JWT guard — populates req.user when a valid token is present,
 * but does NOT throw on missing or invalid tokens.
 * Use on public endpoints that want to enrich responses for authenticated users.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard("jwt") {
  handleRequest<TUser = unknown>(
    _err: Error | null,
    user: TUser | false,
  ): TUser | undefined {
    return user || undefined;
  }
}
