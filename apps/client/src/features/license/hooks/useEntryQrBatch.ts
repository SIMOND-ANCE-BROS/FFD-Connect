import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import {
  EntryQrApi,
  EntryQrNetworkError,
} from "../../../services/api/entry-qr-api";
import { createLogger } from "../../../utils/logger";
import { useAuthRepository } from "../../auth/context/AuthContext";
import { batchRemainingMs, type EntryQrBatch } from "../utils/entryQr";
import {
  clearEntryQrBatch,
  loadEntryQrBatch,
  saveEntryQrBatch,
} from "../utils/entryQrStorage";

const logger = createLogger("useEntryQrBatch");

/**
 * Below this coverage the batch is refreshed (when the network allows): a
 * phone opened at home in the morning still holds a full competition day.
 */
export const ENTRY_QR_REFRESH_BELOW_MS = 6 * 3600 * 1000;

/**
 * Batch of rotating entry QR tokens of the signed-in licensee (#24).
 *
 * On each focus of the E-Licence screen: the cached batch of this account is
 * served at once (works offline, in a gym), then refreshed from the server
 * when it covers less than 6 h. A server answer without a batch (feature
 * off, no valid licence) drops the cache: the static QR is shown instead.
 * Never during an impersonation: the server refuses it, and the device
 * owner's batch must stay untouched.
 */
export function useEntryQrBatch(enabled: boolean): EntryQrBatch | null {
  const auth = useAuthRepository();
  const [batch, setBatch] = useState<EntryQrBatch | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      // Mutable holder: flipped by the cleanup while `load` awaits.
      const run = { cancelled: false };
      const isCancelled = () => run.cancelled;

      const load = async () => {
        const config = await auth.getAuthConfig();
        if (!config.isLoggedIn || config.isGuest || config.impersonating) {
          return;
        }
        const owner = config.username;
        const cached = await loadEntryQrBatch(owner);
        if (isCancelled()) return;
        setBatch(cached);
        if (
          cached &&
          batchRemainingMs(cached, new Date()) > ENTRY_QR_REFRESH_BELOW_MS
        ) {
          return;
        }
        try {
          const result = await EntryQrApi.getMyBatch();
          if (isCancelled()) return;
          if (result.kind === "batch") {
            setBatch(result.batch);
            await saveEntryQrBatch(owner, result.batch);
          } else {
            setBatch(null);
            await clearEntryQrBatch();
          }
        } catch (error) {
          // Offline / backend waking up: keep whatever the cache held.
          if (!(error instanceof EntryQrNetworkError)) throw error;
        }
      };

      load().catch((error: unknown) => {
        logger.warn("Entry QR batch unavailable", error);
      });
      return () => {
        run.cancelled = true;
      };
    }, [auth, enabled]),
  );

  return batch;
}
