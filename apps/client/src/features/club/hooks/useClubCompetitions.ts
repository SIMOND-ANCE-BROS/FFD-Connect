import type { ApiCompetition } from "@ffd-connect/shared";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
// Side-effect: configures the generated OpenAPI client (baseUrl + auth + refresh).
import "../../../api/client";
import { competitionsControllerGetClubCompetitions } from "../../../api/generated/sdk.gen";
import { useAuthStore } from "../../../stores/auth.store";

/**
 * Competitions organized by the signed-in club (#441), from
 * GET /competitions/club/mine.
 *
 * Scoped to the account the session acts as: an impersonation keeps the
 * session alive, so the admin's own list must not stand for the
 * impersonated club's (logout clears the whole cache).
 */
export function clubCompetitionsQueryKey(
  impersonating: boolean = useAuthStore.getState().impersonating,
  impersonatedName: string | null = useAuthStore.getState().impersonatedName,
) {
  return [
    "club-competitions",
    impersonating ? `impersonating:${impersonatedName ?? ""}` : "self",
  ] as const;
}

/** Root shared by every scope of {@link clubCompetitionsQueryKey}. */
export const CLUB_COMPETITIONS_QUERY_ROOT = ["club-competitions"] as const;

export async function fetchClubCompetitions(): Promise<ApiCompetition[]> {
  const { data, error } = await competitionsControllerGetClubCompetitions();
  if (error) {
    throw new Error("Impossible de charger les compétitions du club");
  }
  // The generated client types the rows as free-form objects (the backend
  // returns Prisma rows); they carry the shared ApiCompetition fields.
  return data as unknown as ApiCompetition[];
}

/**
 * Loads the club's competitions and reloads them each time the screen comes
 * back into focus (after the editor created or edited one). The first focus
 * is skipped: the initial query already runs on mount. No polling, no
 * retry — waking a sleeping backend is handled globally (backendWake).
 */
export function useClubCompetitions() {
  const queryClient = useQueryClient();
  const impersonating = useAuthStore((s) => s.impersonating);
  const impersonatedName = useAuthStore((s) => s.impersonatedName);
  const queryKey = clubCompetitionsQueryKey(impersonating, impersonatedName);

  const query = useQuery({
    queryKey,
    queryFn: fetchClubCompetitions,
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
        .invalidateQueries({ queryKey: CLUB_COMPETITIONS_QUERY_ROOT })
        .catch(() => {});
    }, [queryClient]),
  );

  return query;
}
