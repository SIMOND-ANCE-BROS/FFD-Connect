import NetInfo from "@react-native-community/netinfo";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { createLogger } from "../utils/logger";
import api from "../services/api";
import { queryClient } from "../services/queryClient";
import {
  bumpAttempts,
  enqueueMutation,
  hydrateOfflineQueueStore,
  loadQueue,
  markInFlight,
  removeMutations,
  type EnqueueInput,
  type EnqueueResult,
  type PendingMutation,
} from "../services/offlineQueueStorage";

export type { PendingMutation, EnqueueInput, EnqueueResult };

const log = createLogger("useOfflineQueue");

/**
 * A replay that keeps failing is dropped instead of blocking the queue for
 * ever. Five reconnects is well past a transient outage.
 */
export const MAX_REPLAY_ATTEMPTS = 5;

/** What to do with an entry whose replay failed. */
export type ReplayDecision = "drop" | "retry";

interface UseOfflineQueueOptions {
  mutationFn?: (
    m: { endpoint: string; payload: unknown },
    mutation: PendingMutation,
  ) => Promise<unknown>;
  onConflict?: () => void;
  /**
   * Feature-level classification of a failed replay. Return `undefined` to
   * fall back to the default policy (409 → drop + onConflict, else retry).
   * A "drop" is final: the entry is removed and its query keys invalidated.
   */
  onReplayError?: (
    mutation: PendingMutation,
    error: unknown,
  ) => ReplayDecision | undefined;
  onReplaySuccess?: (mutation: PendingMutation) => void;
  /** An entry dropped after MAX_REPLAY_ATTEMPTS failures. */
  onReplayExhausted?: (mutation: PendingMutation, error: unknown) => void;
}

function httpStatusOf(err: unknown): number | null {
  return err !== null &&
    typeof err === "object" &&
    "response" in err &&
    err.response !== null &&
    typeof err.response === "object" &&
    "status" in err.response &&
    typeof err.response.status === "number"
    ? err.response.status
    : null;
}

/** Default dispatch: "METHOD /path" through the shared axios instance. */
export async function dispatchMutation(m: {
  endpoint: string;
  payload: unknown;
}): Promise<void> {
  const [method, path] = m.endpoint.split(" ");
  if (method === "POST") await api.post(path, m.payload);
  else if (method === "PATCH") await api.patch(path, m.payload);
  else if (method === "DELETE") await api.delete(path);
}

async function invalidate(mutation: PendingMutation): Promise<void> {
  for (const key of mutation.queryKeysToInvalidate) {
    await queryClient.invalidateQueries({ queryKey: key });
  }
}

/** Single replay at a time: NetInfo emits bursts of "connected" events. */
let processing: Promise<void> | null = null;

export function useOfflineQueue(options: UseOfflineQueueOptions = {}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const processQueueRef = useRef<(() => void) | null>(null);
  const connectedRef = useRef<(() => boolean) | null>(null);

  useEffect(() => {
    const runQueue = async () => {
      const queue = await loadQueue();
      if (queue.length === 0) return;

      log.info(`Processing ${queue.length} queued mutation(s) after reconnect`);

      const settled: string[] = [];
      for (const mutation of queue) {
        const opts = optionsRef.current;
        // `queue` is a snapshot and it goes stale while we await: a producer
        // can collapse an entry we have not reached yet. Collapsing only skips
        // in-flight ids, and only the CURRENT entry is in-flight — so an entry
        // further down is removed from storage while this loop still holds it.
        // Dispatching it would send an action the user has just cancelled.
        const current = await loadQueue();
        if (!current.some((m) => m.id === mutation.id)) {
          log.info(`Skipping ${mutation.endpoint}: cancelled while replaying`);
          continue;
        }
        markInFlight([mutation.id], true);
        try {
          const request = {
            endpoint: mutation.endpoint,
            payload: mutation.payload,
          };
          if (opts.mutationFn) await opts.mutationFn(request, mutation);
          else await dispatchMutation(request);
          settled.push(mutation.id);
          await invalidate(mutation);
          opts.onReplaySuccess?.(mutation);
          log.info(`Mutation replayed successfully: ${mutation.endpoint}`);
        } catch (err: unknown) {
          let decision = opts.onReplayError?.(mutation, err);
          if (decision === undefined) {
            const isConflict = httpStatusOf(err) === 409;
            decision = isConflict ? "drop" : "retry";
            if (isConflict) {
              log.warn(`Conflict (409) on ${mutation.endpoint} — discarding`);
              opts.onConflict?.();
            }
          }
          if (decision === "drop") {
            settled.push(mutation.id);
            await invalidate(mutation);
          } else {
            const attempts = await bumpAttempts(mutation.id);
            if (attempts >= MAX_REPLAY_ATTEMPTS) {
              // Poison entry: it has had its chances and would otherwise sit
              // at the head of the queue blocking everything behind it.
              log.error(
                `Dropping ${mutation.endpoint} after ${attempts} failed replays`,
              );
              settled.push(mutation.id);
              await invalidate(mutation);
              opts.onReplayExhausted?.(mutation, err);
              continue;
            }
            // No HTTP answer: the network (or the backend wake) is not there
            // yet, so nothing after this would fare better — stop the batch
            // rather than hammer the API. A server that DID answer proves the
            // network works, so the fault is this entry alone: skip it and
            // let the rest through.
            const answered = httpStatusOf(err) !== null;
            log.error(
              `Failed to replay ${mutation.endpoint} (attempt ${attempts})`,
            );
            if (!answered) break;
            continue;
          }
        } finally {
          markInFlight([mutation.id], false);
        }
      }

      await removeMutations(settled);

      // Entries enqueued WHILE this batch ran are not in the snapshot, and no
      // NetInfo event will fire for them. Pick them up now instead of leaving
      // them until the next reconnect — but only genuinely NEW ones: an entry
      // that just failed must wait for the next trigger, not be retried on the
      // spot.
      const seen = new Set(queue.map((m) => m.id));
      const added = (await loadQueue()).filter((m) => !seen.has(m.id));
      if (added.length > 0) await runQueue();
    };

    const processQueue = () => {
      if (processing) return;
      processing = runQueue()
        .catch((err: unknown) => {
          log.error("processQueue: unexpected error", err);
        })
        .finally(() => {
          processing = null;
        });
    };

    hydrateOfflineQueueStore().catch((err: unknown) => {
      log.error("hydrate: unexpected error", err);
    });

    // Event-driven only (no polling): network regained, or app back to the
    // foreground while connected (a network-error fallback leaves NetInfo
    // "connected", so no reconnect event would ever fire for it).
    let connected = false;
    const unsubscribe = NetInfo.addEventListener((state) => {
      connected =
        state.isConnected === true && state.isInternetReachable !== false;
      if (!connected) return;
      processQueue();
    });
    const appStateSub = AppState.addEventListener("change", (status) => {
      if (status === "active" && connected) processQueue();
    });

    processQueueRef.current = processQueue;
    connectedRef.current = () => connected;

    return () => {
      unsubscribe();
      appStateSub.remove();
      processQueueRef.current = null;
    };
  }, []);

  /**
   * A network error while NetInfo still reports "connected" (a timeout, say)
   * queues the action but fires no reconnect event — the entry would sit there
   * until the user backgrounds the app. Kick the replay right away instead.
   */
  const enqueue = async (mutation: EnqueueInput): Promise<EnqueueResult> => {
    const result = await enqueueMutation(mutation);
    if (result === "enqueued" && connectedRef.current?.()) {
      processQueueRef.current?.();
    }
    return result;
  };

  return { enqueue };
}
