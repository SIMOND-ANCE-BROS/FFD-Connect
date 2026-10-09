import { SetMetadata } from "@nestjs/common";

/**
 * Store-review account (App Store / Google Play validation, `isStoreReview`):
 * StoreReviewInterceptor SIMULATES its authenticated writes and serves its
 * authenticated reads from an ALLOWLIST only. These decorators tune that per
 * route.
 */
export const STORE_REVIEW_PASSTHROUGH_KEY = "storeReviewPassthrough";
export const STORE_REVIEW_SIMULATION_KEY = "storeReviewSimulation";
export const STORE_REVIEW_READ_KEY = "storeReviewRead";
export const STORE_REVIEW_READABLE_KEY = "storeReviewReadable";

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
 * Simulated body of a GET the store-review account may NOT read (not on the
 * read allowlist), when the default empty value inferred from the route's
 * Swagger response (`[]` for an array, `{}` otherwise) is not the shape the
 * client expects (paginated pages, career…).
 */
export const StoreReviewRead = (builder: SimulatedResponseBuilder) =>
  SetMetadata(STORE_REVIEW_READ_KEY, builder);

export interface StoreReviewReadableOptions {
  /** The route serves the requester's own data (built from req.user). */
  ownData?: boolean;
  /** Real data only when this holds (e.g. the route targets the account). */
  when?: (ctx: SimulationContext) => boolean;
}

/**
 * READ ALLOWLIST of the store-review account. Its authenticated GETs are DENY
 * BY DEFAULT: only a route carrying this decorator returns real data to it
 * (its own profile, license, career, notifications; its flagged club; the
 * public catalog). Every other GET returns an empty result, so a new endpoint
 * is empty for that account until it is reviewed and allowlisted here.
 * Allowlisted responses still go through the personal-data masking (defense
 * in depth); `ownData` keeps the account's own records unmasked.
 */
export const StoreReviewReadable = (options: StoreReviewReadableOptions = {}) =>
  SetMetadata(STORE_REVIEW_READABLE_KEY, options);

/** Allowlisted read of the requester's own data (shorthand). */
export const StoreReviewOwnData = (
  options: Omit<StoreReviewReadableOptions, "ownData"> = {},
) => StoreReviewReadable({ ...options, ownData: true });
