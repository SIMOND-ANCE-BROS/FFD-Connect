import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { API_GLOBAL_PREFIX } from "../common/api-prefix";
import type { RequestWithUser } from "./interfaces/jwt-payload.interface";
import { ImpersonationActionLogService } from "./impersonation-action-log.service";

/** Methods that never change anything: not journalled. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Route recorded when no route matched (404): never the raw URL. */
export const UNMATCHED_ROUTE = "(unmatched)";

/**
 * Template of the matched route without the global prefix, e.g.
 * "/competitions/:id/unregister". Never the concrete URL: no ids, no query.
 */
export function routeTemplateOf(req: Request): string {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof path !== "string") return UNMATCHED_ROUTE;
  const prefix = `/${API_GLOBAL_PREFIX}`;
  return path.startsWith(prefix) ? path.slice(prefix.length) || "/" : path;
}

/** `req.user` is only there once JwtAuthGuard accepted the token. */
type MaybeAuthenticatedRequest = Request & {
  user?: Pick<RequestWithUser["user"], "impersonatedBy" | "impersonationLogId">;
};

/**
 * Support access (#761): journals every non-GET request made under an
 * impersonation token — `{ session, method, route template, status }` — once
 * the response is over.
 *
 * A middleware rather than an interceptor so that the writes REFUSED by a
 * guard (403 from NoImpersonationGuard, RolesGuard…) are journalled too: an
 * interceptor only runs once every guard has let the request through. At
 * `close` time `req.user` has been set by JwtStrategy, which re-validated the
 * session against the database; a request whose token was refused (401) has
 * no user and is not journalled (no valid session to attach it to).
 */
@Injectable()
export class ImpersonationActionLogMiddleware implements NestMiddleware {
  constructor(private readonly actionLog: ImpersonationActionLogService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (!READ_METHODS.has(req.method.toUpperCase())) {
      res.once("close", () => {
        const user = (req as MaybeAuthenticatedRequest).user;
        const impersonationLogId = user?.impersonatedBy
          ? user.impersonationLogId
          : undefined;
        if (!impersonationLogId) return;
        void this.actionLog.record({
          impersonationLogId,
          method: req.method.toUpperCase(),
          route: routeTemplateOf(req),
          statusCode: res.statusCode,
        });
      });
    }
    next();
  }
}
