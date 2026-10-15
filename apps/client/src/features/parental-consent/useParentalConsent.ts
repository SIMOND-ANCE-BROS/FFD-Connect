import { useFocusEffect } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  ParentalConsentApi,
  type ParentalConsentStateDto,
} from "../../services/api/parental-consent-api";
import { useAuthStore } from "../../stores/auth.store";

/**
 * Parental consent state of the account the session acts as (#61). Scoped
 * like the renewal status: an impersonation keeps the session alive, so the
 * admin's own state must not stand for the impersonated account's. Kept out
 * of the persisted cache (queryClient.tsx): it carries a parent's masked
 * address.
 */
export function parentalConsentQueryKey(
  impersonating: boolean,
  impersonatedName: string | null,
) {
  return [
    "parental-consent",
    impersonating ? `impersonating:${impersonatedName ?? ""}` : "self",
  ] as const;
}

/** A PENDING state read less than this long ago is not read again on focus. */
export const PARENTAL_CONSENT_FRESH_MS = 30_000;

/**
 * Loads the state once per mount — no polling, no refetch on foreground
 * (scale-to-zero backend: every request wakes it). On focus it is read again
 * only while PENDING: the parent answers by e-mail, behind the app's back.
 * A guest has no account: nothing is read.
 */
export function useParentalConsent() {
  const queryClient = useQueryClient();
  const isGuest = useAuthStore((s) => s.isGuest);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const impersonating = useAuthStore((s) => s.impersonating);
  const impersonatedName = useAuthStore((s) => s.impersonatedName);
  const queryKey = useMemo(
    () => parentalConsentQueryKey(impersonating, impersonatedName),
    [impersonating, impersonatedName],
  );
  const enabled = isLoggedIn === true && !isGuest;

  const query = useQuery({
    queryKey,
    queryFn: () => ParentalConsentApi.getMine(),
    enabled,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  useFocusEffect(
    useCallback(() => {
      const state =
        queryClient.getQueryState<ParentalConsentStateDto>(queryKey);
      if (
        !enabled ||
        state?.data?.state !== "PENDING" ||
        Date.now() - state.dataUpdatedAt < PARENTAL_CONSENT_FRESH_MS
      ) {
        return;
      }
      void queryClient.refetchQueries(
        { queryKey, exact: true },
        { cancelRefetch: false },
      );
    }, [queryClient, enabled, queryKey]),
  );

  const request = useMutation({
    mutationFn: (parentEmail: string) =>
      ParentalConsentApi.request(parentEmail),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
    },
  });

  return {
    consent: enabled ? query.data : undefined,
    isLoading: enabled && query.isLoading,
    error: query.error,
    refetch: query.refetch,
    request,
  };
}
