import { useFocusEffect } from "@react-navigation/native";
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { useAuthRepository } from "../../auth/context/AuthContext";
import {
  BackendService,
  LicenseRenewalStatus,
} from "../../../services/BackendService";
import { useAuthStore } from "../../../stores/auth.store";

/**
 * Status of the signed-in account's latest renewal request (#268). Only the
 * status is cached — never the documents, whose OCR reading is health data —
 * and the `license-renewal` root is kept out of the persisted cache
 * (queryClient.tsx).
 *
 * Scoped to the account the session acts as: an impersonation keeps the
 * session and the mounted tabs alive, so the admin's own status must not
 * stand for the impersonated account's (logout clears the whole cache).
 * The renewal screen writes this key when it loads or submits a request, so
 * the banner is right on the way back: that write counts as a fresh read,
 * and the focus refresh (PENDING only) skips it for
 * {@link RENEWAL_STATUS_FRESH_MS}.
 */
export function renewalStatusQueryKey(
  impersonating: boolean = useAuthStore.getState().impersonating,
  impersonatedName: string | null = useAuthStore.getState().impersonatedName,
) {
  return [
    "license-renewal",
    "status",
    impersonating ? `impersonating:${impersonatedName ?? ""}` : "self",
  ] as const;
}

/**
 * A status read (or written by the renewal screen) less than this long ago is
 * not read again: no duplicate request on the way back from the renewal
 * screen, nor one per tab switch.
 */
export const RENEWAL_STATUS_FRESH_MS = 30_000;

/**
 * Re-reads the cached status, but only while it is PENDING — the one state a
 * decision can change behind the licensee's back — and older than
 * {@link RENEWAL_STATUS_FRESH_MS}. Any other status (or none) costs no
 * request: scale-to-zero backend, every request wakes it.
 * `cancelRefetch: false` joins a fetch already in flight.
 */
export function refreshRenewalStatusIfPending(
  queryClient: QueryClient,
  queryKey: ReturnType<typeof renewalStatusQueryKey>,
): Promise<void> {
  const state = queryClient.getQueryState(queryKey);
  if (
    state?.data !== "PENDING" ||
    Date.now() - state.dataUpdatedAt < RENEWAL_STATUS_FRESH_MS
  ) {
    return Promise.resolve();
  }
  return queryClient.refetchQueries(
    { queryKey, exact: true },
    { cancelRefetch: false },
  );
}

/** {@link refreshRenewalStatusIfPending} for the current account (pull-to-refresh). */
export function useRefreshRenewalStatusIfPending(): () => Promise<void> {
  const queryClient = useQueryClient();
  const impersonating = useAuthStore((s) => s.impersonating);
  const impersonatedName = useAuthStore((s) => s.impersonatedName);
  return useCallback(
    () =>
      refreshRenewalStatusIfPending(
        queryClient,
        renewalStatusQueryKey(impersonating, impersonatedName),
      ),
    [queryClient, impersonating, impersonatedName],
  );
}

/**
 * True while the account's renewal request awaits a federation decision.
 * Loaded when a screen showing the banner mounts — no polling, no refetch on
 * foreground (scale-to-zero backend: every request wakes it). When the screen
 * regains focus with a PENDING status, it is read again: the Licence tab stays
 * mounted, and the banner must not outlive the decision.
 */
export function useRenewalPending(): boolean {
  const auth = useAuthRepository();
  const impersonating = useAuthStore((s) => s.impersonating);
  const impersonatedName = useAuthStore((s) => s.impersonatedName);
  const refreshIfPending = useRefreshRenewalStatusIfPending();

  useFocusEffect(
    useCallback(() => {
      void refreshIfPending();
    }, [refreshIfPending]),
  );

  const { data } = useQuery({
    queryKey: renewalStatusQueryKey(impersonating, impersonatedName),
    queryFn: async (): Promise<LicenseRenewalStatus | null> => {
      const config = await auth.getAuthConfig();
      if (!config.authToken || !config.isLoggedIn) return null;
      const request = await BackendService.getMyRenewalRequest(
        config.authToken,
      );
      return request?.status ?? null;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  return data === "PENDING";
}
