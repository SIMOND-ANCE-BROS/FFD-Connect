import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { LicenseRenewalDocumentType } from "@prisma/client";
import { Observable } from "rxjs";
import { mergeMap } from "rxjs/operators";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { API_GLOBAL_PREFIX } from "../common/api-prefix";
import type { HealthDataAccessEntry } from "../health-data-access/dto/health-data-access-log.dto";
import { HealthDataAccessLogService } from "../health-data-access/health-data-access-log.service";
import { RENEWAL_REASON_HEALTH_DATA } from "./dto/admin-license-renewal.dto";

/** The part of a renewal response that tells whether it carries health data. */
interface RenewalResponseShape {
  id: string;
  rejectionReason?: string | null;
  documents?: readonly { type: string }[];
}

function isRenewalResponse(body: unknown): body is RenewalResponseShape {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { id?: unknown }).id === "string"
  );
}

/**
 * Health data in a renewal response: a medical certificate (its OCR hints) or
 * a medical refusal reason.
 */
export function carriesHealthData(body: RenewalResponseShape): boolean {
  return (
    body.rejectionReason === RENEWAL_REASON_HEALTH_DATA ||
    (body.documents ?? []).some(
      (document) =>
        document.type === LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
    )
  );
}

/** Route template without the global prefix, e.g. "GET /licenses/renewal/my". */
export function routeTemplate(req: RequestWithUser): string {
  const routePath = (req.route as { path?: unknown } | undefined)?.path;
  const path = typeof routePath === "string" ? routePath : "(unknown)";
  return `${req.method} ${path.replace(`/${API_GLOBAL_PREFIX}`, "")}`;
}

/**
 * Licensee renewal routes (#63): the licensee's own reads are not logged —
 * the data subject reading their own data is not an access by a third party,
 * and the app reads it often. But an administrator or staff member using
 * "log in as" (#545) sees the same response: that IS a third-party access to
 * health data. The trace is written before the response leaves; if it cannot
 * be, the request fails instead of serving untraced health data.
 *
 * The POST routes (start, document upload, submit) refuse an impersonated
 * session outright since #760 (NoImpersonationGuard runs before this
 * interceptor): only the read route can reach the trace below. The
 * interceptor stays on the POST routes as defence in depth.
 */
@Injectable()
export class ImpersonatedRenewalAccessInterceptor implements NestInterceptor {
  constructor(private readonly healthAccess: HealthDataAccessLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const impersonator = req.user.impersonatedBy;
    if (!impersonator) return next.handle();

    return next.handle().pipe(
      mergeMap(async (body: unknown) => {
        if (isRenewalResponse(body) && carriesHealthData(body)) {
          const entry: HealthDataAccessEntry = {
            subjectUserId: req.user.userId,
            actorUserId: impersonator,
            actorRole: "IMPERSONATOR",
            action: "READ",
            resourceType: "LICENSE_RENEWAL_REQUEST",
            resourceId: body.id,
            route: routeTemplate(req),
          };
          await this.healthAccess.record([entry]);
        }
        return body;
      }),
    );
  }
}
