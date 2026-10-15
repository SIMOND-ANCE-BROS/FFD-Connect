import {
  entryQrControllerGetEntryQrKeys,
  entryQrControllerGetMyEntryQr,
} from "../../api/generated";
import type {
  EntryQrBatch,
  EntryQrKeySet,
} from "../../features/license/utils/entryQr";

/**
 * Rotating entry QR (#24, ADR-0024): the licensee's batch of signed tokens
 * and the public keys scanners verify them with offline.
 */
export type EntryQrBatchResult =
  | { kind: "batch"; batch: EntryQrBatch }
  /**
   * The server answered without a batch: no valid licence or feature off
   * (404), impersonated session (403). The cached batch must not be shown.
   */
  | { kind: "unavailable"; status: number | undefined };

/** Status codes meaning "no batch for this account", not "try again later". */
const UNAVAILABLE_STATUSES = new Set([401, 403, 404]);

export class EntryQrNetworkError extends Error {
  constructor() {
    super("Entry QR request failed");
    this.name = "EntryQrNetworkError";
  }
}

export const EntryQrApi = {
  /**
   * Throws EntryQrNetworkError when no usable answer came back (offline,
   * timeout, 5xx other than 503): the caller keeps its cached batch.
   */
  async getMyBatch(): Promise<EntryQrBatchResult> {
    let result: Awaited<ReturnType<typeof entryQrControllerGetMyEntryQr>>;
    try {
      result = await entryQrControllerGetMyEntryQr();
    } catch {
      throw new EntryQrNetworkError();
    }
    const status = result.response?.status;
    if (result.data !== undefined) {
      return { kind: "batch", batch: result.data };
    }
    if (status !== undefined && UNAVAILABLE_STATUSES.has(status)) {
      return { kind: "unavailable", status };
    }
    throw new EntryQrNetworkError();
  },

  /** Public keys, or null when they could not be fetched. */
  async getKeys(): Promise<EntryQrKeySet | null> {
    try {
      const result = await entryQrControllerGetEntryQrKeys();
      return result.data ?? null;
    } catch {
      return null;
    }
  },
};
