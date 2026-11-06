import { CGU_VERSION } from "./cgu-version";
import type { CguAcceptanceDto } from "./dto/cgu-acceptance.dto";

/** Acceptance state from what the account stored (#894). */
export function cguAcceptance(stored: {
  cguAcceptedVersion: string | null;
  cguAcceptedAt: Date | null;
}): CguAcceptanceDto {
  return {
    currentVersion: CGU_VERSION,
    acceptedVersion: stored.cguAcceptedVersion,
    acceptedAt: stored.cguAcceptedAt?.toISOString() ?? null,
    accepted: stored.cguAcceptedVersion === CGU_VERSION,
  };
}
