import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
// Side-effect: configures the generated OpenAPI client (baseUrl + auth + refresh).
import "../../../api/client";
import { competitionsControllerCountClubPendingRegistrations } from "../../../api/generated/sdk.gen";
import { useAuthStore } from "../../../stores/auth.store";

/**
 * Number of registrations awaiting the signed-in club's validation (#944),
 * from GET /competitions/club/pending-registrations/count (#948): the
 * server's exact count, same scope as the list, without its cap.
 *
 * Scoped to the account the session acts as: an impersonation keeps the
 * session alive, so the admin's own count must not stand for the
 * impersonated club's (logout clears the whole cache).
 */
export function clubPendingRegistrationsCountQueryKey(
  impersonating: boolean = useAuthStore.getState().impersonating,
  impersonatedName: string | null = useAuthStore.getState().impersonatedName,
) {
  return [
    "club-pending-registrations-count",
    impersonating ? `impersonating:${impersonatedName ?? ""}` : "self",
  ] as const;
}

/** Root shared by every scope of {@link clubPendingRegistrationsCountQueryKey}. */
export const CLUB_PENDING_REGISTRATIONS_COUNT_QUERY_ROOT = [
  "club-pending-registrations-count",
] as const;

/** A usable count: a non-negative integer. */
function isCount(count: number | undefined): count is number {
  return typeof count === "number" && Number.isInteger(count) && count >= 0;
}

export async function fetchClubPendingRegistrationsCount(): Promise<number> {
  // The server counts (#948): exact beyond the list's cap, and the dashboard
  // no longer downloads the whole list for a number.
  const { data, error } =
    await competitionsControllerCountClubPendingRegistrations();
  // Accept only a real count: anything else is an unknown count, never a
  // made-up 0.
  const count = error ? undefined : data.count;
  if (!isCount(count)) {
    throw new Error("Impossible de charger les inscriptions en attente");
  }
  return count;
}

/**
 * Loads the pending-registrations count and reloads it each time the screen
 * comes back into focus (after the club validated requests). The first focus
 * is skipped: the initial query already runs on mount. `enabled` keeps the
 * request off for clubs whose mode has no validation step. No polling, no
 * retry — waking a sleeping backend is handled globally (backendWake).
 */
export function useClubPendingRegistrationsCount(enabled: boolean) {
  const queryClient = useQueryClient();
  const impersonating = useAuthStore((s) => s.impersonating);
  const impersonatedName = useAuthStore((s) => s.impersonatedName);
  const queryKey = clubPendingRegistrationsCountQueryKey(
    impersonating,
    impersonatedName,
  );

  const query = useQuery({
    queryKey,
    queryFn: fetchClubPendingRegistrationsCount,
    enabled,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const hasFocused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocused.current) {
        hasFocused.current = true;
        return;
      }
      queryClient
        .invalidateQueries({
          queryKey: CLUB_PENDING_REGISTRATIONS_COUNT_QUERY_ROOT,
        })
        .catch(() => {});
    }, [queryClient]),
  );

  return query;
}
