/**
 * Dev couple used by the local seed (`seed.ts`) and the compete sync
 * (`sync-licensees-from-compete.ts`): a leader ("owner") and a follower
 * ("partner"), both CVDS members.
 *
 * Defaults are FICTIONAL on purpose — the repository is public, so no real
 * person may appear here. To seed your own account locally, override any field
 * from the gitignored `apps/backend/.env`:
 *
 *   SEED_OWNER_FIRST_NAME, SEED_OWNER_LAST_NAME, SEED_OWNER_EMAIL,
 *   SEED_OWNER_BIRTH_DATE (YYYY-MM-DD), SEED_OWNER_LICENSE
 *   SEED_PARTNER_FIRST_NAME, SEED_PARTNER_LAST_NAME, SEED_PARTNER_EMAIL,
 *   SEED_PARTNER_BIRTH_DATE (YYYY-MM-DD), SEED_PARTNER_LICENSE
 *
 * Standalone tsx scripts (not Nest): reading process.env directly is expected.
 */
import "dotenv/config";

export interface SeedDancer {
  firstName: string;
  lastName: string;
  email: string;
  /** ISO date, YYYY-MM-DD */
  birthDate: string;
  /** FFD license number, format AAAAMMJJ-xxx-yyNN */
  licenseNumber: string;
  category: string;
}

export interface SeedCouple {
  owner: SeedDancer;
  partner: SeedDancer;
}

const BIRTH_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function envOr(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  // Empty values fall back too (a blank line in .env must not erase a default).
  if (!value) return fallback;
  return value;
}

function birthDateOr(name: string, fallback: string): string {
  const value = envOr(name, fallback);
  if (!BIRTH_DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(
      `${name} must be a valid date (YYYY-MM-DD), got "${value}"`,
    );
  }
  return value;
}

function dancerFromEnv(prefix: string, defaults: SeedDancer): SeedDancer {
  return {
    firstName: envOr(`${prefix}_FIRST_NAME`, defaults.firstName),
    lastName: envOr(`${prefix}_LAST_NAME`, defaults.lastName),
    email: envOr(`${prefix}_EMAIL`, defaults.email).toLowerCase(),
    birthDate: birthDateOr(`${prefix}_BIRTH_DATE`, defaults.birthDate),
    licenseNumber: envOr(`${prefix}_LICENSE`, defaults.licenseNumber),
    category: defaults.category,
  };
}

export const SEED_COUPLE: SeedCouple = {
  owner: dancerFromEnv("SEED_OWNER", {
    firstName: "Lucas",
    lastName: "BERNARD",
    email: "lucas.bernard@example.com",
    birthDate: "2000-01-01",
    licenseNumber: "20000101-ber-lu01",
    category: "Latin",
  }),
  partner: dancerFromEnv("SEED_PARTNER", {
    firstName: "Emma",
    lastName: "MOREAU",
    email: "emma.moreau@example.com",
    birthDate: "2001-01-01",
    licenseNumber: "20010101-mor-em01",
    category: "LICENCE D",
  }),
};

export function fullName(dancer: SeedDancer): string {
  return `${dancer.firstName} ${dancer.lastName}`;
}
