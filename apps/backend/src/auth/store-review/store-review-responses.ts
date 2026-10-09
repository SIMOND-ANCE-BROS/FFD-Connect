import type {
  SimulatedResponseBuilder,
  SimulationContext,
} from "./store-review.decorator";

/**
 * Simulated bodies returned to a store-review account instead of running a
 * write. Each one has the shape its client caller reads, so the app never
 * crashes or shows an error; nothing is stored, so a later GET shows the data
 * unchanged.
 */

const asRecord = (body: unknown): Record<string, unknown> =>
  body !== null && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};

/** Credentials are never echoed back (change-password, account deletion…). */
const SECRET_KEY = /password|token|secret/i;

const echoOf = (body: unknown): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(asRecord(body)).filter(([key]) => !SECRET_KEY.test(key)),
  );

const iso = (d: Date): string => d.toISOString();

/**
 * Default: `{ success: true }` + an echo of the request body (credentials
 * stripped), with the route `:id` (or a fresh one) and timestamps. Fits every
 * caller that ignores the body or only checks it is present.
 */
export const genericSimulatedResponse: SimulatedResponseBuilder = (ctx) => ({
  ...echoOf(ctx.body),
  id: ctx.params.id ?? ctx.newId(),
  success: true,
  simulated: true,
  createdAt: iso(ctx.now),
  updatedAt: iso(ctx.now),
});

/** DELETE /notifications: the client reads `count`. */
export const simulatedDeleteCount: SimulatedResponseBuilder = () => ({
  count: 0,
  success: true,
  simulated: true,
});

const renewalRequest = (
  ctx: SimulationContext,
  id: string,
  status: "DRAFT" | "PENDING",
  documents: object[],
) => ({
  id,
  userId: ctx.userId,
  status,
  documents,
  createdAt: iso(ctx.now),
  updatedAt: iso(ctx.now),
  simulated: true,
});

/** Both documents the client requires before it enables "submit". */
const REQUIRED_RENEWAL_DOCUMENT_TYPES = [
  "MEDICAL_CERTIFICATE",
  "LICENSE_CERTIFICATE",
] as const;

const simulatedDocuments = (ctx: SimulationContext, requestId: string) =>
  REQUIRED_RENEWAL_DOCUMENT_TYPES.map((type) => ({
    id: ctx.newId(),
    requestId,
    type,
    filePath: "",
    createdAt: iso(ctx.now),
  }));

/** POST /licenses/renewal/start: an empty draft (client reads `documents`). */
export const simulatedRenewalStart: SimulatedResponseBuilder = (ctx) =>
  renewalRequest(ctx, ctx.newId(), "DRAFT", []);

/**
 * POST /licenses/renewal/:id/documents. Nothing is stored, so the response
 * cannot list the documents uploaded before: it reports both required ones as
 * received, which lets the reviewer go through to "submit".
 */
export const simulatedRenewalDocument: SimulatedResponseBuilder = (ctx) => {
  const id = ctx.params.id ?? ctx.newId();
  return renewalRequest(ctx, id, "DRAFT", simulatedDocuments(ctx, id));
};

/** POST /licenses/renewal/:id/submit: the request is now pending. */
export const simulatedRenewalSubmit: SimulatedResponseBuilder = (ctx) => {
  const id = ctx.params.id ?? ctx.newId();
  return renewalRequest(ctx, id, "PENDING", simulatedDocuments(ctx, id));
};

/** POST /competitions/:id/checkin: the scanner renders user + registrations. */
export const simulatedCheckIn: SimulatedResponseBuilder = () => ({
  user: { firstName: "Licencié", lastName: "Démonstration" },
  registrations: [
    {
      event: "Démonstration",
      status: "SUCCESS",
      message: "Check-in simulé (compte de démonstration)",
    },
  ],
  simulated: true,
});

const VOLUNTEER_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * POST /competitions/:id/volunteer/token: the link is shown and copied. The
 * token is not stored, so the link does not open a real check-in session.
 */
export const simulatedVolunteerToken: SimulatedResponseBuilder = (ctx) => {
  const competitionId = ctx.params.id ?? "";
  const token = ctx.newId();
  const name = asRecord(ctx.body).name;
  return {
    id: ctx.newId(),
    token,
    competitionId,
    expiresAt: iso(new Date(ctx.now.getTime() + VOLUNTEER_TOKEN_TTL_MS)),
    name: typeof name === "string" && name.trim() ? name : "Bénévole",
    accessUrl: `https://ffd-connect.fr/volunteer/checkin?token=${token}&id=${competitionId}`,
    simulated: true,
  };
};

/** POST /clubs/me/partnerships: the client reads the suggestions. */
export const simulatedPartnership: SimulatedResponseBuilder = (ctx) => ({
  partnership: {
    ...echoOf(ctx.body),
    id: ctx.newId(),
    status: "ACTIVE",
    createdAt: iso(ctx.now),
    updatedAt: iso(ctx.now),
  },
  suggestedCategories: [],
  coupleAgeGroup: null,
  suggestedLevel: null,
  simulated: true,
});

/** Admin paginated reads refused to the store-review account: an empty page. */
export const simulatedEmptyPage: SimulatedResponseBuilder = () => ({
  data: [],
  meta: { total: 0, skip: 0, take: 0, hasMore: false },
  simulated: true,
});
