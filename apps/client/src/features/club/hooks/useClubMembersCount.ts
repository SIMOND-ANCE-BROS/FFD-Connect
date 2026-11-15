import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
// Side-effect: configures the generated OpenAPI client (baseUrl + auth + refresh).
import "../../../api/client";
import { usersControllerGetMembers } from "../../../api/generated/sdk.gen";
import { useAuthStore } from "../../../stores/auth.store";

/**
 * Number of members of the signed-in club (#946), from GET /users/members.
 *
 * Scoped to the account the session acts as: an impersonation keeps the
 * session alive, so the admin's own count must not stand for the
 * impersonated club's (logout clears the whole cache).
 */
export function clubMembersCountQueryKey(
  impersonating: boolean = useAuthStore.getState().impersonating,
  impersonatedName: string | null = useAuthStore.getState().impersonatedName,
) {
  return [
    "club-members-count",
    impersonating ? `impersonating:${impersonatedName ?? ""}` : "self",
  ] as const;
}

/** Root shared by every scope of {@link clubMembersCountQueryKey}. */
export const CLUB_MEMBERS_COUNT_QUERY_ROOT = ["club-members-count"] as const;

/** A usable member count: a non-negative integer. */
function isCount(total: number | undefined): total is number {
  return typeof total === "number" && Number.isInteger(total) && total >= 0;
}

export async function fetchClubMembersCount(): Promise<number> {
  // A one-row page: the server's `meta.total` is the club's real count (the
  // length of a default page would stop at its size).
  const { data, error } = await usersControllerGetMembers({
    query: { take: 1 },
  });
  // Accept only a real total: anything else is an unknown count, never a
  // made-up 0.
  const total = error ? undefined : data.meta.total;
  if (!isCount(total)) {
    throw new Error("Impossible de charger le nombre de membres du club");
  }
  return total;
}

/**
 * Loads the club's member count and reloads it each time the screen comes
 * back into focus (after members were added or removed). The first focus is
 * skipped: the initial query already runs on mount. No polling, no retry —
 * waking a sleeping backend is handled globally (backendWake).
 */
export function useClubMembersCount() {
  const queryClient = useQueryClient();
  const impersonating = useAuthStore((s) => s.impersonating);
  const impersonatedName = useAuthStore((s) => s.impersonatedName);
  const queryKey = clubMembersCountQueryKey(impersonating, impersonatedName);

  const query = useQuery({
    queryKey,
    queryFn: fetchClubMembersCount,
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
        .invalidateQueries({ queryKey: CLUB_MEMBERS_COUNT_QUERY_ROOT })
        .catch(() => {});
    }, [queryClient]),
  );

  return query;
}
