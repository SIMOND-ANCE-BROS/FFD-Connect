import { SetMetadata } from "@nestjs/common";

/**
 * Store-review account (App Store / Google Play validation, `isStoreReview`):
 * its authenticated writes are SIMULATED by StoreReviewInterceptor. These
 * decorators tune that per route.
 */
export const STORE_REVIEW_PASSTHROUGH_KEY = "storeReviewPassthrough";
export const STORE_REVIEW_SIMULATION_KEY = "storeReviewSimulation";
export const STORE_REVIEW_READ_KEY = "storeReviewRead";
export const STORE_REVIEW_OWN_DATA_KEY = "storeReviewOwnData";

/** What a simulated-response builder knows about the request. */
export interface SimulationContext {
  userId: string;
  params: Readonly<Record<string, string | undefined>>;
  body: unknown;
  now: Date;
  newId: () => string;
}

export type SimulatedResponseBuilder = (ctx: SimulationContext) => object;

/**
 * The route really runs for a store-review account. Only for writes that are
 * harmless and needed for the app to work (ephemeral credentials, audit rows).
 */
export const StoreReviewPassthrough = () =>
  SetMetadata(STORE_REVIEW_PASSTHROUGH_KEY, true);

/**
 * The simulated body of this route, when the generic echo does not match
 * what the client reads (see store-review-responses.ts).
 */
export const StoreReviewSimulation = (builder: SimulatedResponseBuilder) =>
  SetMetadata(STORE_REVIEW_SIMULATION_KEY, builder);

/**
 * A READ whose data cannot be masked field by field (lists of every account,
 * audit log with free-form before/after JSON): a store-review account gets
 * this simulated body instead and the handler never runs.
 */
export const StoreReviewRead = (builder: SimulatedResponseBuilder) =>
  SetMetadata(STORE_REVIEW_READ_KEY, builder);

/**
 * The route serves the requester's own data (built from `req.user.userId`):
 * for a store-review account its records stay unmasked, except nested person
 * records of other people.
 */
export const StoreReviewOwnData = () =>
  SetMetadata(STORE_REVIEW_OWN_DATA_KEY, true);
