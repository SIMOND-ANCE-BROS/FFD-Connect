import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
// Side-effect: configures the generated OpenAPI client (baseUrl + auth + refresh).
import "../../../api/client";
import { competitionsControllerGetClubPendingRegistrations } from "../../../api/generated/sdk.gen";
import { useAuthStore } from "../../../stores/auth.store";

/**
 * Number of registrations awaiting the signed-in club's validation (#944),
 * from GET /competitions/club/pending-registrations (bounded server side).
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

export async function fetchClubPendingRegistrationsCount(): Promise<number> {
  const { data, error } =
    await competitionsControllerGetClubPendingRegistrations();
  // The generated client types the payload as `unknown` (free-form backend
  // schema): anything but a list is an unknown count, never a made-up 0.
  if (error || !Array.isArray(data)) {
    throw new Error("Impossible de charger les inscriptions en attente");
  }
  return data.length;
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
