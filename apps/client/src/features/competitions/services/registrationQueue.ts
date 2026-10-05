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
}

export type SubmitOutcome =
  | { status: "sent" }
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
} as const;

/** Thrown before replay when the deadline passed while the phone was offline. */
export class RegistrationDeadlinePassedError extends Error {
  constructor() {
    super("Registration deadline passed");
    this.name = "RegistrationDeadlinePassedError";
  }
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
  const { competitionId, eventId, partnerName, registrationDeadline } = target;
  const meta: Record<string, string> = { action, competitionId, eventId };
  if (registrationDeadline) meta.registrationDeadline = registrationDeadline;
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
export async function submitRegistrationAction(
  action: RegistrationAction,
  target: RegistrationTarget,
  send: () => Promise<unknown>,
  pending: PendingMutation[],
): Promise<SubmitOutcome> {
  const queue = async (): Promise<SubmitOutcome> => {
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
    await send();
    return { status: "sent" };
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
): { decision: ReplayDecision; message?: string } {
  const action = actionOf(m);
  if (err instanceof RegistrationDeadlinePassedError) {
    return {
      decision: "drop",
      message: QUEUE_MESSAGES.DEADLINE_PASSED_ON_REPLAY,
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
    return { decision: "drop", message: QUEUE_MESSAGES.SESSION_EXPIRED };
  }
  if (status === 409) {
    return {
      decision: "drop",
      message:
        action === "register"
          ? QUEUE_MESSAGES.ALREADY_REGISTERED
          : (serverMessageOf(err) ?? QUEUE_MESSAGES.UNREGISTER_REFUSED),
    };
  }
  if (status === 404) {
    return {
      decision: "drop",
      message:
        action === "unregister"
          ? QUEUE_MESSAGES.ALREADY_UNREGISTERED
          : QUEUE_MESSAGES.EVENT_NOT_FOUND,
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
  };
}

/** `onReplayError` for the engine; `undefined` for non-registration items. */
export function handleRegistrationReplayError(
  m: PendingMutation,
  err: unknown,
): ReplayDecision | undefined {
  if (!isRegistrationMutation(m)) return undefined;
  const { decision, message } = classifyRegistrationReplayError(m, err);
  if (decision === "drop" && message) {
    Alert.alert(QUEUE_MESSAGES.REPLAY_REJECTED_TITLE, message);
  }
  return decision;
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
  Alert.alert(
    QUEUE_MESSAGES.REPLAYED_TITLE,
    action === "register"
      ? QUEUE_MESSAGES.REPLAYED_REGISTER
      : QUEUE_MESSAGES.REPLAYED_UNREGISTER,
  );
}
