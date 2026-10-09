import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { Observable, of } from "rxjs";
import { map } from "rxjs/operators";
import { maskPersonalData } from "./store-review-masking";
import { genericSimulatedResponse } from "./store-review-responses";
import {
  STORE_REVIEW_PASSTHROUGH_KEY,
  STORE_REVIEW_SIMULATION_KEY,
  SimulatedResponseBuilder,
} from "./store-review.decorator";

/** Response header set on every simulated write. */
export const DEMO_MODE_HEADER = "X-Demo-Mode";
export const DEMO_MODE_SIMULATED = "simulated";

const MUTATING_METHODS: ReadonlySet<string> = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

interface MaybeStoreReviewRequest extends Request {
  user?: { userId?: string; storeReview?: boolean };
}

/**
 * Simulated-write mode of the store-review account (App Store / Google Play
 * validation). For an authenticated request of such an account, a write
 * (POST/PUT/PATCH/DELETE) never reaches its handler: the route's usual 2xx
 * status comes back with a plausible body and `X-Demo-Mode: simulated`, and
 * nothing is written. Reviewers never get an error from it.
 *
 * `req.user.storeReview` is set by JwtStrategy from its per-request account
 * lookup (no extra query). Routes without a JWT guard (login, refresh,
 * logout, register, password reset, TTS, webhooks) have no `req.user` and run
 * normally. A route opts out with @StoreReviewPassthrough(); a route whose
 * client reads specific fields declares its body with @StoreReviewSimulation().
 *
 * Every response that really runs for such an account (reads, passthrough
 * writes) has other people's personal data masked (store-review-masking.ts).
 */
@Injectable()
export class StoreReviewInterceptor implements NestInterceptor {
  private readonly logger = new Logger(StoreReviewInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<MaybeStoreReviewRequest>();
    const user = req.user;
    if (!user?.storeReview) return next.handle();
    const ownerId = user.userId ?? "";
    // Reads (and passthrough writes) really run, but other people's personal
    // data is masked: the account is ADMIN with a password shared with the
    // stores (see store-review-masking.ts).
    const maskedHandle = () =>
      next
        .handle()
        .pipe(map((body: unknown) => maskPersonalData(body, ownerId)));
    if (!MUTATING_METHODS.has(req.method)) return maskedHandle();
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(
        STORE_REVIEW_PASSTHROUGH_KEY,
        targets,
      )
    ) {
      return maskedHandle();
    }
    const builder =
      this.reflector.getAllAndOverride<SimulatedResponseBuilder | undefined>(
        STORE_REVIEW_SIMULATION_KEY,
        targets,
      ) ?? genericSimulatedResponse;

    http
      .getResponse<Response>()
      .setHeader(DEMO_MODE_HEADER, DEMO_MODE_SIMULATED);
    const route = req.route as { path?: string } | undefined;
    this.logger.log(
      `Store-review account: simulated ${req.method} ${route?.path ?? req.path}`,
    );
    return of(
      builder({
        userId: ownerId,
        params: req.params as Record<string, string | undefined>,
        body: req.body as unknown,
        now: new Date(),
        newId: randomUUID,
      }),
    );
  }
}
