import { useQuery } from "@tanstack/react-query";
import { useAuthRepository } from "../../auth/context/AuthContext";
import {
  BackendService,
  LicenseRenewalStatus,
} from "../../../services/BackendService";

/**
 * Status of the licensee's latest renewal request (#268). Only the status is
 * cached — never the documents, whose OCR reading is health data — and the
 * root is kept out of the persisted cache (queryClient.tsx).
 *
 * The renewal screen writes this key when it loads or submits a request, so
 * the banner is right on the way back without another request.
 */
export const RENEWAL_STATUS_QUERY_KEY = ["license-renewal", "status"] as const;

/**
 * True while the licensee's renewal request awaits a federation decision.
 * Loaded when a screen showing the banner mounts — no polling, no refetch on
 * foreground (scale-to-zero backend: every request wakes it).
 */
export function useRenewalPending(): boolean {
  const auth = useAuthRepository();

  const { data } = useQuery({
    queryKey: RENEWAL_STATUS_QUERY_KEY,
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
