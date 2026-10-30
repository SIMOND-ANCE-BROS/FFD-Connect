import type { PrismaClient } from "@prisma/client";
import { parisEndOfDay } from "../src/licenses/qr/license-qr";
import {
  idOnlySelect,
  licenseRecetteStateSelect,
} from "../src/utils/prisma-selects";

/**
 * Staging recette licences and the state each one must be put in (#887).
 *
 * The numbers are FICTITIOUS (recette accounts created on staging, `rec`
 * marker): no personal data, so they can live in the code. `validUntilDay` is
 * a Paris calendar day (`YYYY-MM-DD`):
 * - `19920510-rec-re03` until 31/12/2026: valid today but renewable, since it
 *   does not cover the season ending 31/08/2027 (`isLicenseCoveredForRenewal`);
 * - `19880101-rec-ex04` until 31/08/2026: expired.
 */
export const RECETTE_LICENSE_STATES: readonly RecetteLicenseState[] = [
  { number: "19920510-rec-re03", validUntilDay: "2026-12-31" },
  { number: "19880101-rec-ex04", validUntilDay: "2026-08-31" },
];

export interface RecetteLicenseState {
  number: string;
  validUntilDay: string;
}

export type RecetteLicenseOutcome =
  | "updated"
  | "missing"
  | "renewal-requested"
  | "already-set"
  | "changed-meanwhile";

/**
 * Last instant of the Paris calendar day `day` (23:59:59.999 Paris time):
 * the same convention as a granted licence's `validUntil` (#238).
 */
export function parisLastInstantOfDay(day: string): Date {
  return new Date(parisEndOfDay(day).getTime() - 1);
}

/**
 * The seed only ever runs on staging: the entrypoint already gates it on
 * SEED_TEST_TRACKS=true, checked again here so a manual run elsewhere is a
 * no-op.
 */
export function isRecetteSeedEnabled(
  seedTestTracks: string | undefined,
): boolean {
  return seedTestTracks === "true";
}

/**
 * Puts one recette licence in its target state, exactly once:
 * - unknown number → nothing (licences and accounts are never created);
 * - a renewal request exists for its holder, whatever its status → never
 *   touched again, so a requested or approved renewal survives later boots;
 * - `validUntil` already at the target instant → nothing.
 * The write itself re-checks both conditions (same `validUntil` as read, no
 * renewal request), so a renewal requested or approved in between is never
 * overwritten.
 */
export async function applyRecetteLicenseState(
  prisma: Pick<PrismaClient, "license" | "licenseRenewalRequest">,
  target: RecetteLicenseState,
): Promise<RecetteLicenseOutcome> {
  const license = await prisma.license.findUnique({
    where: { number: target.number },
    select: licenseRecetteStateSelect,
  });
  if (!license) return "missing";

  if (license.userId) {
    const request = await prisma.licenseRenewalRequest.findFirst({
      where: { userId: license.userId },
      select: idOnlySelect,
    });
    if (request) return "renewal-requested";
  }

  const validUntil = parisLastInstantOfDay(target.validUntilDay);
  if (license.validUntil.getTime() === validUntil.getTime()) {
    return "already-set";
  }

  const { count } = await prisma.license.updateMany({
    where: {
      id: license.id,
      validUntil: license.validUntil,
      OR: [
        { userId: null },
        { user: { licenseRenewalRequests: { none: {} } } },
      ],
    },
    data: { validUntil },
  });
  return count === 1 ? "updated" : "changed-meanwhile";
}
