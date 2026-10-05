import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  useOfflineQueueStore,
  type PendingMutation,
} from "../stores/offlineQueue.store";
import { createLogger } from "../utils/logger";

export type { PendingMutation };

/**
 * Persistence layer of the offline mutation queue (#416).
 *
 * Kept free of React / React Query imports so non-UI code (logout) can purge
 * it without pulling the query client in. Every read-modify-write goes
 * through a single promise chain: the replay loop and a producer enqueuing
 * at the same time must never overwrite each other's changes.
 */
export const OFFLINE_QUEUE_KEY = "@ffd/offline-queue";
const log = createLogger("offlineQueueStorage");

export type EnqueueInput = Omit<PendingMutation, "id" | "enqueuedAt">;

/**
 * - `enqueued`: new entry persisted.
 * - `duplicate`: the same action is already pending — nothing changed.
 * - `collapsed`: the opposite action was pending — both cancel out, the
 *   pending entry was removed and nothing will be replayed.
 */
export type EnqueueResult = "enqueued" | "duplicate" | "collapsed";

let lock: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(task: () => Promise<T>): Promise<T> {
  const run = lock.then(task, task);
  lock = run.catch(() => undefined);
  return run;
}

/** Ids currently being replayed: collapsing them would be a lie. */
const inFlightIds = new Set<string>();

export function markInFlight(ids: string[], inFlight: boolean): void {
  for (const id of ids) {
    if (inFlight) inFlightIds.add(id);
    else inFlightIds.delete(id);
  }
}

export async function loadQueue(): Promise<PendingMutation[]> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingMutation[]) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: PendingMutation[]): Promise<void> {
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  useOfflineQueueStore.getState().setItems(queue);
}

/** Loads the persisted queue into the store (app start / engine mount). */
export async function hydrateOfflineQueueStore(): Promise<PendingMutation[]> {
  const queue = await loadQueue();
  useOfflineQueueStore.getState().setItems(queue);
  return queue;
}

export function enqueueMutation(input: EnqueueInput): Promise<EnqueueResult> {
  return withQueueLock(async () => {
    const queue = await loadQueue();

    if (input.collapseKey) {
      // The last entry for a target is the effective pending intent.
      const last = queue
        .filter((m) => m.collapseKey === input.collapseKey)
        .pop();
      if (last?.endpoint === input.endpoint) {
        log.info(`Duplicate ignored: ${input.endpoint}`);
        return "duplicate";
      }
      if (last && !inFlightIds.has(last.id)) {
        await saveQueue(queue.filter((m) => m.id !== last.id));
        log.info(`Collapsed ${last.endpoint} with ${input.endpoint}`);
        return "collapsed";
      }
    }

    const entry: PendingMutation = {
      ...input,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      enqueuedAt: Date.now(),
    };
    await saveQueue([...queue, entry]);
    log.info(`Enqueued mutation: ${input.endpoint}`);
    return "enqueued";
  });
}

/** Records a failed replay so a poison entry can be dropped eventually. */
export function bumpAttempts(id: string): Promise<number> {
  return withQueueLock(async () => {
    const queue = await loadQueue();
    let next = 0;
    const updated = queue.map((m) => {
      if (m.id !== id) return m;
      next = (m.attempts ?? 0) + 1;
      return { ...m, attempts: next };
    });
    await saveQueue(updated);
    return next;
  });
}

/** Removes settled entries, preserving anything enqueued meanwhile. */
export function removeMutations(ids: string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve();
  return withQueueLock(async () => {
    const queue = await loadQueue();
    await saveQueue(queue.filter((m) => !ids.includes(m.id)));
  });
}

/** Full logout: queued actions belong to the session that created them. */
export function clearOfflineQueue(): Promise<void> {
  return withQueueLock(async () => {
    await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
    useOfflineQueueStore.getState().setItems([]);
  });
}
