import NetInfo from "@react-native-community/netinfo";
import axios from "axios";
import { Alert } from "react-native";
import type { ReplayDecision } from "../../../hooks/useOfflineQueue";
import {
  enqueueMutation,
  type EnqueueResult,
  type PendingMutation,
} from "../../../services/offlineQueueStorage";
import { queryKeys } from "../../../services/queryKeys";
import { formatDiscipline } from "../../../utils/discipline";
import { createLogger } from "../../../utils/logger";
import {
  cancelDeadlineNotificationForCompetition,
  clearDeadlineMarker,
} from "../../../utils/scheduleDeadlineNotification";

/**
 * Offline queue producer for licensee self-registration (#416).
 *
 * Only `POST /competitions/:id/register` and `/unregister` are queued: both
 * are pure API calls (no HelloAsso checkout, no interactive step — the
 * partner name is collected BEFORE the call). Club-side actions
 * (register-member, confirm) are not queued.
 */
const log = createLogger("registrationQueue");

export const REGISTRATION_KIND = "registration";

export type RegistrationAction = "register" | "unregister";

export interface RegistrationTarget {
  competitionId: string;
  eventId: string;
  partnerName?: string;
  /** ISO date — replaying a register after it is dropped client-side. */
  registrationDeadline?: string;
  /** Names for the replay recap (#859); never sent to the API. */
  competitionTitle?: string;
  eventLabel?: string;
}

export type SubmitOutcome<T = unknown> =
  | { status: "sent"; result?: T }
  | { status: "queued" }
  | { status: "collapsed" }
  | { status: "duplicate" };

export const QUEUE_MESSAGES = {
  QUEUED_TITLE: "En attente de réseau",
  QUEUED_REGISTER:
    "Vous êtes hors ligne. Votre inscription sera envoyée automatiquement dès le retour du réseau.",
  QUEUED_UNREGISTER:
    "Vous êtes hors ligne. Votre désinscription sera envoyée automatiquement dès le retour du réseau.",
  COLLAPSED_TITLE: "Action annulée",
  COLLAPSED:
    "L'action en attente de réseau a été annulée : rien ne sera envoyé.",
  DUPLICATE: "Cette action est déjà en attente de réseau.",
  DEADLINE_TITLE: "Inscriptions closes",
  DEADLINE_PASSED:
    "La date limite d'inscription est dépassée : l'inscription hors ligne n'est pas possible.",
  DEADLINE_PASSED_ON_REPLAY:
    "Votre inscription en attente n'a pas été envoyée : la date limite d'inscription est dépassée.",
  REPLAY_REJECTED_TITLE: "Action en attente refusée",
  ALREADY_REGISTERED:
    "Votre inscription en attente n'était pas nécessaire : vous êtes déjà inscrit(e) à cette épreuve.",
  ALREADY_UNREGISTERED:
    "Votre désinscription en attente n'était pas nécessaire : aucune inscription active n'a été trouvée.",
  EVENT_NOT_FOUND:
    "Votre inscription en attente n'a pas été envoyée : l'épreuve n'existe plus.",
  SESSION_EXPIRED:
    "Votre session a expiré : l'action en attente n'a pas été envoyée. Reconnectez-vous puis recommencez.",
  REGISTER_REFUSED: "Votre inscription en attente a été refusée.",
  UNREGISTER_REFUSED: "Votre désinscription en attente a été refusée.",
  REPLAYED_TITLE: "Connexion rétablie",
  REPLAYED_REGISTER: "Votre inscription en attente a bien été envoyée.",
  REPLAYED_UNREGISTER: "Votre désinscription en attente a bien été envoyée.",
  EXHAUSTED_TITLE: "Action en attente abandonnée",
  EXHAUSTED_UNNAMED_EVENT: "Épreuve",
  EXHAUSTED_RETRY_REGISTER:
    "Rien n'a été enregistré : recommencez l'inscription depuis la fiche de la compétition.",
  EXHAUSTED_RETRY_UNREGISTER:
    "Rien n'a été enregistré : recommencez la désinscription depuis la fiche de la compétition.",
  RECAP_TITLE: "Connexion rétablie",
  RECAP_UNNAMED_EVENT: "Épreuve",
} as const;

/** Short refusal reasons, for the recap of several replays (#859). */
export const REFUSAL_REASONS = {
  DEADLINE_PASSED: "la date limite d'inscription est dépassée",
  SESSION_EXPIRED: "votre session a expiré, reconnectez-vous puis recommencez",
  ALREADY_REGISTERED: "vous étiez déjà inscrit(e)",
  ALREADY_UNREGISTERED: "aucune inscription active n'a été trouvée",
  EVENT_NOT_FOUND: "l'épreuve n'existe plus",
} as const;

/** Why a replay was given up after MAX_REPLAY_ATTEMPTS failures (#874). */
export const EXHAUSTED_REASONS = {
  UNREACHABLE: "le serveur est resté injoignable",
  SERVER_ERROR: "le serveur a répondu par une erreur",
  OVERLOADED: "le serveur était surchargé",
} as const;

/** Thrown before replay when the deadline passed while the phone was offline. */
export class RegistrationDeadlinePassedError extends Error {
  constructor() {
    super("Registration deadline passed");
    this.name = "RegistrationDeadlinePassedError";
  }
}

/** « Latines Samba Adultes C »: names an event in the replay recap. */
export function eventRecapLabel(event: {
  category?: string | null;
  dance?: string | null;
  ageGroup?: string | null;
  level?: string | null;
}): string {
  return [
    formatDiscipline(event.category),
    event.dance,
    event.ageGroup,
    event.level,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}

export function registrationEndpoint(
  action: RegistrationAction,
  competitionId: string,
): string {
  return `POST /competitions/${competitionId}/${action}`;
}

function collapseKey(competitionId: string, eventId: string): string {
  return `${REGISTRATION_KIND}:${competitionId}:${eventId}`;
}

export function isRegistrationMutation(m: PendingMutation): boolean {
  return m.kind === REGISTRATION_KIND;
}

function actionOf(m: PendingMutation): RegistrationAction {
  return m.meta?.action === "unregister" ? "unregister" : "register";
}

export function isDeadlinePassed(
  deadline: string | undefined,
  now: number = Date.now(),
): boolean {
  if (!deadline) return false;
  const t = new Date(deadline).getTime();
  return !Number.isNaN(t) && t < now;
}

/**
 * Network failure = the request never got an HTTP answer (offline, DNS,
 * timeout, backend still asleep after the global wake gave up). A 4xx/5xx is
 * a server answer and must surface as an error, never be queued.
 */
export function isNetworkError(err: unknown): boolean {
  return (
    axios.isAxiosError(err) && !err.response && err.code !== "ERR_CANCELED"
  );
}

export async function isDeviceOffline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected === false || state.isInternetReachable === false;
  } catch {
    return false;
  }
}

function hasPendingFor(
  pending: PendingMutation[],
  competitionId: string,
  eventId: string,
): boolean {
  const key = collapseKey(competitionId, eventId);
  return pending.some((m) => m.collapseKey === key);
}

export function enqueueRegistrationAction(
  action: RegistrationAction,
  target: RegistrationTarget,
): Promise<EnqueueResult> {
  const {
    competitionId,
    eventId,
    partnerName,
    registrationDeadline,
    competitionTitle,
    eventLabel,
  } = target;
  const meta: Record<string, string> = { action, competitionId, eventId };
  if (registrationDeadline) meta.registrationDeadline = registrationDeadline;
  if (competitionTitle) meta.competitionTitle = competitionTitle;
  if (eventLabel) meta.eventLabel = eventLabel;
  return enqueueMutation({
    endpoint: registrationEndpoint(action, competitionId),
    // Body must stay DTO-only: the backend runs forbidNonWhitelisted.
    payload:
      action === "register" && partnerName
        ? { eventId, partnerName }
        : { eventId },
    queryKeysToInvalidate: [
      [...queryKeys.registrations.my],
      [...queryKeys.competitions.detail(competitionId)],
    ],
    kind: REGISTRATION_KIND,
    collapseKey: collapseKey(competitionId, eventId),
    meta,
  });
}

/**
 * Sends a registration action, or queues it when there is no network.
 *
 * - Offline (NetInfo) or an action already pending for the same event →
 *   straight to the queue (collapse/dedupe applies, no doomed request that
 *   would trigger the global wake overlay).
 * - Online → direct call; only a network error falls back to the queue.
 * - Deadline already passed → throws RegistrationDeadlinePassedError
 *   instead of queuing (the caller shows a "requires network" message).
 */
export async function submitRegistrationAction<T = unknown>(
  action: RegistrationAction,
  target: RegistrationTarget,
  send: () => Promise<T>,
  pending: PendingMutation[],
): Promise<SubmitOutcome<T>> {
  const queue = async (): Promise<SubmitOutcome<T>> => {
    if (action === "register" && isDeadlinePassed(target.registrationDeadline))
      throw new RegistrationDeadlinePassedError();
    const result = await enqueueRegistrationAction(action, target);
    return { status: result === "enqueued" ? "queued" : result };
  };

  if (
    hasPendingFor(pending, target.competitionId, target.eventId) ||
    (await isDeviceOffline())
  ) {
    return queue();
  }

  try {
    const result = await send();
    return { status: "sent", result };
  } catch (err: unknown) {
    if (!isNetworkError(err)) throw err;
    log.warn(`Network error on ${action}, queuing for replay`);
    return queue();
  }
}

/** Effective pending intent per event of one competition (last entry wins). */
export function getPendingRegistrationActions(
  items: PendingMutation[],
  competitionId: string,
): Record<string, RegistrationAction> {
  const result: Record<string, RegistrationAction> = {};
  for (const m of items) {
    if (!isRegistrationMutation(m)) continue;
    if (m.meta?.competitionId !== competitionId || !m.meta.eventId) continue;
    result[m.meta.eventId] = actionOf(m);
  }
  return result;
}

/**
 * Events the user is registered to, from GET /competitions/user/registrations.
 * Unregistering keeps the row as CANCELLED (history), so it must not count:
 * otherwise the CTA stays « Désinscrire » after a successful unregister
 * (#549). Rows without status (optimistic register) count.
 */
export function activeRegistrationEventIds(
  registrations: readonly { eventId: string; status?: string }[] | undefined,
): string[] {
  return (registrations ?? [])
    .filter((r) => r.status !== "CANCELLED")
    .map((r) => r.eventId);
}

/** Server registrations with the pending (optimistic) actions applied. */
export function applyPendingRegistrations(
  serverEventIds: string[],
  pending: Record<string, RegistrationAction>,
): string[] {
  const ids = new Set(serverEventIds);
  for (const [eventId, action] of Object.entries(pending)) {
    if (action === "register") ids.add(eventId);
    else ids.delete(eventId);
  }
  return [...ids];
}

function serverMessageOf(err: unknown): string | null {
  if (!axios.isAxiosError(err)) return null;
  const data: unknown = err.response?.data;
  if (data === null || typeof data !== "object" || !("message" in data))
    return null;
  const { message } = data;
  if (typeof message === "string" && message.trim()) return message;
  if (Array.isArray(message) && typeof message[0] === "string")
    return message[0];
  return null;
}

function statusOf(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined;
}

/** Replay-time guard: dispatch unless the deadline passed meanwhile. */
export function assertReplayable(m: PendingMutation): void {
  if (
    isRegistrationMutation(m) &&
    actionOf(m) === "register" &&
    isDeadlinePassed(m.meta?.registrationDeadline)
  ) {
    throw new RegistrationDeadlinePassedError();
  }
}

/**
 * Classifies a failed registration replay. Network errors, 5xx, 408 and
 * 429 are transient (kept for the next reconnect); every other server answer
 * is final: dropped with a specific message. The UI rolls back by itself
 * (the pending overlay disappears and the engine invalidates the queries).
 */
export function classifyRegistrationReplayError(
  m: PendingMutation,
  err: unknown,
): {
  decision: ReplayDecision;
  message?: string;
  /** Short refusal reason for the recap, when one is known. */
  reason?: string;
} {
  const action = actionOf(m);
  if (err instanceof RegistrationDeadlinePassedError) {
    return {
      decision: "drop",
      message: QUEUE_MESSAGES.DEADLINE_PASSED_ON_REPLAY,
      reason: REFUSAL_REASONS.DEADLINE_PASSED,
    };
  }
  const status = statusOf(err);
  if (
    status === undefined ||
    status >= 500 ||
    status === 408 ||
    status === 429
  ) {
    return { decision: "retry" };
  }
  // 401 reaching us means the silent refresh already failed: the session is
  // over, retrying would only replay under whoever logs in next.
  if (status === 401) {
    return {
      decision: "drop",
      message: QUEUE_MESSAGES.SESSION_EXPIRED,
      reason: REFUSAL_REASONS.SESSION_EXPIRED,
    };
  }
  if (status === 409) {
    if (action === "register") {
      return {
        decision: "drop",
        message: QUEUE_MESSAGES.ALREADY_REGISTERED,
        reason: REFUSAL_REASONS.ALREADY_REGISTERED,
      };
    }
    const serverMessage = serverMessageOf(err);
    return {
      decision: "drop",
      message: serverMessage ?? QUEUE_MESSAGES.UNREGISTER_REFUSED,
      reason: serverMessage ?? undefined,
    };
  }
  if (status === 404) {
    return action === "unregister"
      ? {
          decision: "drop",
          message: QUEUE_MESSAGES.ALREADY_UNREGISTERED,
          reason: REFUSAL_REASONS.ALREADY_UNREGISTERED,
        }
      : {
          decision: "drop",
          message: QUEUE_MESSAGES.EVENT_NOT_FOUND,
          reason: REFUSAL_REASONS.EVENT_NOT_FOUND,
        };
  }
  // 400/403/410/422…: eligibility, club-only mode, and — should the backend
  // start enforcing them — full event / closed registrations. The server
  // message is the most specific thing we can show.
  const fallback =
    action === "register"
      ? QUEUE_MESSAGES.REGISTER_REFUSED
      : QUEUE_MESSAGES.UNREGISTER_REFUSED;
  const serverMessage = serverMessageOf(err);
  return {
    decision: "drop",
    message: serverMessage ? `${fallback}\n${serverMessage}` : fallback,
    reason: serverMessage ?? undefined,
  };
}

/** What one replayed registration action ended with (#859). */
export interface RegistrationReplayOutcome {
  action: RegistrationAction;
  result: "sent" | "refused";
  competitionTitle?: string;
  eventLabel?: string;
  /** Refusal reason, short form (recap only). */
  reason?: string;
  /** The alert shown when this outcome is the only one of its run. */
  alert: { title: string; message: string };
}

function outcomeOf(
  m: PendingMutation,
  result: RegistrationReplayOutcome["result"],
  alert: RegistrationReplayOutcome["alert"],
  reason?: string,
): RegistrationReplayOutcome {
  return {
    action: actionOf(m),
    result,
    competitionTitle: m.meta?.competitionTitle,
    eventLabel: m.meta?.eventLabel,
    reason,
    alert,
  };
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}

/** One recap line: « Open de Lyon — Latines Adultes C : inscription envoyée ». */
function recapLine(o: RegistrationReplayOutcome): string {
  const name =
    [o.competitionTitle, o.eventLabel].filter(Boolean).join(" — ") ||
    QUEUE_MESSAGES.RECAP_UNNAMED_EVENT;
  const what = o.action === "register" ? "inscription" : "désinscription";
  if (o.result === "sent") return `• ${name} : ${what} envoyée`;
  return o.reason
    ? `• ${name} : ${what} refusée. Motif : ${o.reason}`
    : `• ${name} : ${what} refusée`;
}

/**
 * The alert for a whole replay run (#859). A single outcome keeps its own
 * alert, exactly as before; several are listed in one recap, refusals with
 * their reason.
 */
export function buildReplayRecap(
  outcomes: readonly RegistrationReplayOutcome[],
): { title: string; message: string } | null {
  if (outcomes.length === 0) return null;
  if (outcomes.length === 1) return outcomes[0].alert;
  const sent = outcomes.filter((o) => o.result === "sent").length;
  const refused = outcomes.length - sent;
  const counts = [
    sent > 0 ? plural(sent, "envoyée", "envoyées") : null,
    refused > 0 ? plural(refused, "refusée", "refusées") : null,
  ]
    .filter(Boolean)
    .join(", ");
  const header = `${outcomes.length} actions en attente ont été traitées (${counts}) :`;
  return {
    title: QUEUE_MESSAGES.RECAP_TITLE,
    message: [header, ...outcomes.map(recapLine)].join("\n"),
  };
}

/**
 * Outcomes of the replay run in progress; null outside a run, where each
 * outcome is shown on its own (a direct call of the handlers).
 */
let replayBatch: RegistrationReplayOutcome[] | null = null;

function report(outcome: RegistrationReplayOutcome): void {
  if (replayBatch) {
    replayBatch.push(outcome);
    return;
  }
  Alert.alert(outcome.alert.title, outcome.alert.message);
}

/** `onReplayBatchStart` for the engine. */
export function beginRegistrationReplayBatch(): void {
  replayBatch = [];
}

/** `onReplayBatchEnd` for the engine: one alert for the whole run. */
export function endRegistrationReplayBatch(): void {
  const outcomes = replayBatch ?? [];
  replayBatch = null;
  const recap = buildReplayRecap(outcomes);
  if (recap) Alert.alert(recap.title, recap.message);
}

/** `onReplayError` for the engine; `undefined` for non-registration items. */
export function handleRegistrationReplayError(
  m: PendingMutation,
  err: unknown,
): ReplayDecision | undefined {
  if (!isRegistrationMutation(m)) return undefined;
  const { decision, message, reason } = classifyRegistrationReplayError(m, err);
  if (decision === "drop" && message) {
    report(
      outcomeOf(
        m,
        "refused",
        { title: QUEUE_MESSAGES.REPLAY_REJECTED_TITLE, message },
        reason,
      ),
    );
  }
  return decision;
}

function exhaustedReasonOf(err: unknown): string {
  const status = statusOf(err);
  if (status === 429) return EXHAUSTED_REASONS.OVERLOADED;
  if (status !== undefined && status >= 500) {
    return EXHAUSTED_REASONS.SERVER_ERROR;
  }
  // No HTTP answer, or a 408: the request never got through.
  return EXHAUSTED_REASONS.UNREACHABLE;
}

/**
 * The alert for a registration action the engine gave up on (#874). Names
 * come from the entry's metadata (competition title and event label, stored
 * at enqueue time since #859); without them the wording stays generic.
 */
export function buildExhaustedAlert(
  m: PendingMutation,
  err: unknown,
): { title: string; message: string } {
  const action = actionOf(m);
  const what = action === "register" ? "inscription" : "désinscription";
  const name =
    [m.meta?.competitionTitle, m.meta?.eventLabel]
      .filter(Boolean)
      .join(" — ") || QUEUE_MESSAGES.EXHAUSTED_UNNAMED_EVENT;
  // No count here: MAX_REPLAY_ATTEMPTS lives in the engine, and importing a
  // value from it would close a require cycle through queryClient.tsx.
  const reason = `${exhaustedReasonOf(err)} malgré plusieurs tentatives`;
  return {
    title: QUEUE_MESSAGES.EXHAUSTED_TITLE,
    message: [
      `Votre ${what} en attente n'a pas pu être envoyée :`,
      `• ${name} : ${what} abandonnée. Motif : ${reason}`,
      action === "register"
        ? QUEUE_MESSAGES.EXHAUSTED_RETRY_REGISTER
        : QUEUE_MESSAGES.EXHAUSTED_RETRY_UNREGISTER,
    ].join("\n"),
  };
}

/**
 * `onReplayExhausted` for the engine (#874): the entry has been dropped after
 * MAX_REPLAY_ATTEMPTS transient failures. Without this the registration
 * vanished silently and the dancer believed they were registered.
 */
export function handleRegistrationReplayExhausted(
  m: PendingMutation,
  err: unknown,
): void {
  if (!isRegistrationMutation(m)) return;
  log.warn(`Registration ${actionOf(m)} abandoned after replays`);
  const { title, message } = buildExhaustedAlert(m, err);
  Alert.alert(title, message);
}

/** `onReplaySuccess` for the engine: mirrors the online success side effects. */
export function handleRegistrationReplaySuccess(m: PendingMutation): void {
  if (!isRegistrationMutation(m)) return;
  const competitionId = m.meta?.competitionId;
  const action = actionOf(m);
  if (competitionId) {
    if (action === "register")
      void cancelDeadlineNotificationForCompetition(competitionId);
    else void clearDeadlineMarker(competitionId);
  }
  report(
    outcomeOf(m, "sent", {
      title: QUEUE_MESSAGES.REPLAYED_TITLE,
      message:
        action === "register"
          ? QUEUE_MESSAGES.REPLAYED_REGISTER
          : QUEUE_MESSAGES.REPLAYED_UNREGISTER,
    }),
  );
}
