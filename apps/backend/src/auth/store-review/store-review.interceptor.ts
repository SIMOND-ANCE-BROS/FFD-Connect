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
  STORE_REVIEW_READABLE_KEY,
  STORE_REVIEW_READ_KEY,
  STORE_REVIEW_SIMULATION_KEY,
  SimulatedResponseBuilder,
  SimulationContext,
  StoreReviewReadableOptions,
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

/** Swagger metadata of a route's documented responses (by status code). */
const SWAGGER_RESPONSES_KEY = "swagger/apiResponse";

interface SwaggerResponseMeta {
  type?: unknown;
  isArray?: boolean;
  schema?: { type?: string };
}

/**
 * Empty result of a non-allowlisted GET: `[]` when the route documents an
 * array (Swagger `isArray`, `type: [Dto]` or `schema.type: "array"`), `{}`
 * otherwise. Paginated routes declare their empty page with @StoreReviewRead.
 */
export function emptyReadFor(handler: object): SimulatedResponseBuilder {
  const responses = Reflect.getMetadata(SWAGGER_RESPONSES_KEY, handler) as
    | Record<string, SwaggerResponseMeta | undefined>
    | undefined;
  const ok = responses?.["200"];
  const isArray =
    ok?.isArray === true ||
    Array.isArray(ok?.type) ||
    ok?.schema?.type === "array";
  return () => (isArray ? [] : {});
}

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
 * Its reads are DENY BY DEFAULT: a GET returns real data only when the route
 * is on the read allowlist (@StoreReviewReadable / @StoreReviewOwnData);
 * otherwise an empty result of the route's shape (@StoreReviewRead, or
 * `emptyReadFor`) with `X-Demo-Mode: simulated`. Allowlisted responses still
 * have other people's personal data masked (store-review-masking.ts).
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
    const targets = [context.getHandler(), context.getClass()];
    const meta = <T>(key: string) =>
      this.reflector.getAllAndOverride<T | undefined>(key, targets);
    const ctx: SimulationContext = {
      userId: ownerId,
      params: req.params as Record<string, string | undefined>,
      body: req.body as unknown,
      now: new Date(),
      newId: randomUUID,
    };

    let builder: SimulatedResponseBuilder | undefined;
    let ownedRoot = false;
    if (MUTATING_METHODS.has(req.method)) {
      if (!meta<boolean>(STORE_REVIEW_PASSTHROUGH_KEY)) {
        builder =
          meta<SimulatedResponseBuilder>(STORE_REVIEW_SIMULATION_KEY) ??
          genericSimulatedResponse;
      }
    } else {
      // Reads: DENY BY DEFAULT. Only an allowlisted route serves real data.
      const readable = meta<StoreReviewReadableOptions>(
        STORE_REVIEW_READABLE_KEY,
      );
      if (readable && (!readable.when || readable.when(ctx))) {
        ownedRoot = readable.ownData === true;
      } else {
        builder =
          meta<SimulatedResponseBuilder>(STORE_REVIEW_READ_KEY) ??
          emptyReadFor(context.getHandler());
      }
    }

    if (!builder) {
      // Really runs. Defense in depth: other people's personal data is still
      // masked (the account is ADMIN with a password shared with the stores).
      return next
        .handle()
        .pipe(
          map((body: unknown) => maskPersonalData(body, ownerId, ownedRoot)),
        );
    }

    http
      .getResponse<Response>()
      .setHeader(DEMO_MODE_HEADER, DEMO_MODE_SIMULATED);
    const route = req.route as { path?: string } | undefined;
    this.logger.log(
      `Store-review account: simulated ${req.method} ${route?.path ?? req.path}`,
    );
    return of(builder(ctx));
  }
}
