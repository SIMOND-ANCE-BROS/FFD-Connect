import { useQuery } from "@tanstack/react-query";
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
 * the banner is right on the way back without another request.
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
 * True while the account's renewal request awaits a federation decision.
 * Loaded when a screen showing the banner mounts — no polling, no refetch on
 * foreground (scale-to-zero backend: every request wakes it).
 */
export function useRenewalPending(): boolean {
  const auth = useAuthRepository();
  const impersonating = useAuthStore((s) => s.impersonating);
  const impersonatedName = useAuthStore((s) => s.impersonatedName);

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
