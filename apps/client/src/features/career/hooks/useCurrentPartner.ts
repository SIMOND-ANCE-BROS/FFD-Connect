import { useQuery } from "@tanstack/react-query";
import {
  CareerApi,
  type CareerPartnership,
} from "../../../services/api/career-api";
import { queryKeys } from "../../../services/queryKeys";
import { useAuthRepository } from "../../auth/context/AuthContext";

/**
 * The dancer's registered partner (#858), from their career (/career/me).
 * - `unknown`: not loaded yet, failed or not asked (not a licensee) — the
 *   UI must then say nothing rather than claim there is no partner.
 * - `none`: no current partnership.
 * - `registered`: a current partnership; `name` is the partner's full name.
 */
export type CurrentPartner =
  | { status: "unknown" }
  | { status: "none" }
  | { status: "registered"; name: string };

const UNKNOWN: CurrentPartner = { status: "unknown" };

/** Name of the current partner, or null when no partnership is current. */
export function getCurrentPartnerName(
  partnerships: readonly CareerPartnership[],
): string | null {
  const current = partnerships.find((p) => p.isCurrent);
  if (!current) return null;
  // A current partnership with an empty (scrubbed) name still counts.
  return `${current.partner.firstName} ${current.partner.lastName}`.trim();
}

export function toCurrentPartner(
  partnerships: readonly CareerPartnership[] | undefined,
): CurrentPartner {
  if (!partnerships) return UNKNOWN;
  const name = getCurrentPartnerName(partnerships);
  return name === null ? { status: "none" } : { status: "registered", name };
}

/** Five minutes: a partnership changes rarely, the club declares it. */
const STALE_TIME_MS = 5 * 60 * 1000;

export function useCurrentPartner(enabled: boolean): CurrentPartner {
  const auth = useAuthRepository();
  const { data } = useQuery({
    queryKey: queryKeys.career.me,
    queryFn: async () => {
      const config = await auth.getAuthConfig();
      if (!config.authToken) throw new Error("Not signed in");
      const career = await CareerApi.getMyCareer(config.authToken);
      return career.partnerships;
    },
    enabled,
    staleTime: STALE_TIME_MS,
    // A missing hint is harmless: no retry storm against a sleeping API.
    retry: false,
  });
  return enabled ? toCurrentPartner(data) : UNKNOWN;
}
