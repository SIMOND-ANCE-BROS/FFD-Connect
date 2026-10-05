import { create } from "zustand";

/**
 * A mutation waiting for the network (#416). Persisted as JSON in
 * AsyncStorage by `services/offlineQueueStorage` and replayed by
 * `hooks/useOfflineQueue` on reconnect.
 */
export interface PendingMutation {
  id: string;
  /** "METHOD /path" — dispatched as-is on replay. */
  endpoint: string;
  /** Request body sent on replay (must only contain DTO fields). */
  payload: unknown;
  queryKeysToInvalidate: string[][];
  enqueuedAt: number;
  /**
   * Failed replays so far. An entry that keeps failing is dropped rather than
   * blocking the queue behind it for ever (poison message).
   */
  attempts?: number;
  /** Routes the replay outcome to a feature handler (e.g. "registration"). */
  kind?: string;
  /**
   * Entries sharing a collapse key target the same resource: the same
   * endpoint twice is a duplicate (ignored), a different endpoint is the
   * opposite action and cancels the pending one (net no-op).
   */
  collapseKey?: string;
  /** Client-only data for UI/handlers — never sent to the API. */
  meta?: Record<string, string>;
}

/**
 * In-memory mirror of the persisted offline queue, so screens can render the
 * pending state ("En attente de réseau") reactively. Source of truth stays
 * AsyncStorage; only `offlineQueueStorage` writes here.
 */
interface OfflineQueueState {
  items: PendingMutation[];
  setItems: (items: PendingMutation[]) => void;
}

export const useOfflineQueueStore = create<OfflineQueueState>((set) => ({
  items: [],
  setItems: (items) => set({ items }),
}));
