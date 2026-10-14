import type { PrismaClient } from "@prisma/client";
import {
  BETA_AUTO_LICENSE_CLUB_NAME,
  BETA_LICENSE_PLACEHOLDER_CATEGORY,
  LEGACY_BETA_LICENSE_CATEGORY,
} from "../src/licenses/beta-license-placeholder";
import { licenseIdHolderSelect } from "../src/utils/prisma-selects";

export interface BetaLicense {
  number: string;
  category: string;
  clubName: string;
  validUntil: Date;
}

const DEFAULT_CLUB_NAME = "Club Villeurbannais de Danse Sportive";
const DEFAULT_VALID_UNTIL = new Date("2026-12-31");

/**
 * Upper bound of one repair pass. Staging holds a handful of beta testers; a
 * leftover beyond it is picked up at the next boot.
 */
export const BETA_LICENSE_REPAIR_BATCH = 500;

/**
 * Beta licences to pre-seed, from BETA_TESTER_LICENSES (comma-separated).
 * The tester's discipline is unknown: the category is the placeholder, never
 * a discipline that registration would copy into the profile (#555).
 */
export function betaLicensesFromEnv(raw: string | undefined): BetaLicense[] {
  return (raw ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n.length > 0)
    .map((number) => ({
      number,
      category: BETA_LICENSE_PLACEHOLDER_CATEGORY,
      clubName: DEFAULT_CLUB_NAME,
      validUntil: DEFAULT_VALID_UNTIL,
    }));
}

export interface BetaLicenseRepairResult {
  licenses: number;
  users: number;
}

/**
 * Repairs the beta licences created before #555 with a made-up "Ten Dance"
 * category — pre-seeded numbers (BETA_TESTER_LICENSES) and licences
 * auto-created under BETA_AUTO_LICENSE (placeholder club) — including those
 * already linked to an account:
 * - the licence category becomes the placeholder;
 * - the holder's `User.category`, copied from it at registration, goes back to
 *   null (unknown) if it still reads "Ten Dance".
 *
 * Both writes run in one transaction, so a licence is only moved off "Ten
 * Dance" together with its holder: the repair is effectively one-shot and
 * later boots find nothing to do. A real federation licence is never touched
 * (neither a listed number nor the placeholder club).
 */
export async function repairBetaLicenseCategories(
  prisma: Pick<PrismaClient, "license" | "user" | "$transaction">,
  betaNumbers: readonly string[],
): Promise<BetaLicenseRepairResult> {
  const stale = await prisma.license.findMany({
    where: {
      category: LEGACY_BETA_LICENSE_CATEGORY,
      OR: [
        { number: { in: [...betaNumbers] } },
        { clubName: BETA_AUTO_LICENSE_CLUB_NAME },
      ],
    },
    select: licenseIdHolderSelect,
    take: BETA_LICENSE_REPAIR_BATCH,
  });
  if (stale.length === 0) return { licenses: 0, users: 0 };

  const holderIds = stale
    .map((license) => license.userId)
    .filter((id): id is string => id !== null);

  const [licenses, users] = await prisma.$transaction([
    prisma.license.updateMany({
      where: {
        id: { in: stale.map((license) => license.id) },
        category: LEGACY_BETA_LICENSE_CATEGORY,
      },
      data: { category: BETA_LICENSE_PLACEHOLDER_CATEGORY },
    }),
    prisma.user.updateMany({
      where: {
        id: { in: holderIds },
        category: LEGACY_BETA_LICENSE_CATEGORY,
      },
      data: { category: null },
    }),
  ]);
  return { licenses: licenses.count, users: users.count };
}
