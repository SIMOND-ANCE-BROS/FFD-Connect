import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useAuthRepository } from "../../auth/context/AuthContext";
import {
  LicenseApi,
  type LicenseRenewalRequest,
} from "../../../services/api/license-api";
import { isRenewalUnderReview } from "../utils/renewalReview";

/**
 * Cache key of the signed-in user's renewal status. Its root is excluded
 * from the persisted cache (services/queryClient.tsx).
 */
export const MY_RENEWAL_STATUS_QUERY_KEY = ["license-renewal", "my"] as const;

/**
 * What the Licence and Profile screens need of the renewal request: its
 * status only. Documents, OCR readings and the review outcome stay on the
 * renewal screen and are never cached.
 */
export type RenewalStatusSummary = Pick<LicenseRenewalRequest, "id" | "status">;

export function toRenewalStatusSummary(
  request: LicenseRenewalRequest | null,
): RenewalStatusSummary | null {
  return request ? { id: request.id, status: request.status } : null;
}

/** Updates the cached status after the renewal screen got a fresh request. */
export function setMyRenewalStatus(
  queryClient: QueryClient,
  request: LicenseRenewalRequest | null,
): void {
  queryClient.setQueryData(
    MY_RENEWAL_STATUS_QUERY_KEY,
    toRenewalStatusSummary(request),
  );
}

/**
 * Whether the signed-in user's latest renewal request waits for the
 * administrator's decision (#268) — drives the « en cours de vérification »
 * banner. `false` while loading, on error, for a guest or when `enabled` is
 * false.
 */
export function useRenewalUnderReview(enabled = true): boolean {
  const auth = useAuthRepository();
  const { data } = useQuery({
    queryKey: MY_RENEWAL_STATUS_QUERY_KEY,
    queryFn: async (): Promise<RenewalStatusSummary | null> => {
      const config = await auth.getAuthConfig();
      if (!config.authToken || !config.isLoggedIn) return null;
      return toRenewalStatusSummary(
        await LicenseApi.getMyRenewalRequest(config.authToken),
      );
    },
    enabled,
  });
  return enabled && isRenewalUnderReview(data);
}
