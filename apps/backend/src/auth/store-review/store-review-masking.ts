/**
 * Personal-data masking of the responses served to a store-review account.
 *
 * That account is ADMIN with every extra role (so reviewers see every screen)
 * and its password is shared with Apple / Google. Its writes are simulated,
 * but its reads would expose other people's data through the admin, club and
 * competition endpoints. Every response it gets goes through `maskPersonalData`:
 * contact data, birth dates, license identifiers and documents of OTHER
 * people are blanked, last names cut to an initial. Its own records (an object
 * whose `id` or `userId` is the account's id) are left whole, so its profile,
 * E-licence QR and Wallet pass keep working.
 */

export const MASKED_EMAIL = "masque@exemple.invalid";
const MASKED_LICENSE_NUMBER = "••••••";

/** Keys blanked (set to null) wherever they appear in someone else's record. */
const NULLED_KEYS: ReadonlySet<string> = new Set([
  "birthDate",
  "phone",
  "phoneNumber",
  "address",
  "street",
  "postalCode",
  "zipCode",
  "ip",
  "wdsfMin",
  "qrCode",
  "qrCodeSignature",
  "filePath",
  "ocrData",
]);

/** Guard against pathological nesting (JSON columns). */
const MAX_DEPTH = 25;

type Json = unknown;

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

const initial = (name: unknown): unknown =>
  typeof name === "string" && name.trim()
    ? `${name.trim().charAt(0).toUpperCase()}.`
    : name;

function maskValue(
  key: string,
  value: unknown,
  parentKey: string | undefined,
): { replaced: true; value: unknown } | { replaced: false } {
  if (value === null || value === undefined) return { replaced: false };
  if (NULLED_KEYS.has(key)) return { replaced: true, value: null };
  if (key === "email" || key === "confirmEmail") {
    return { replaced: true, value: MASKED_EMAIL };
  }
  if (key === "lastName") return { replaced: true, value: initial(value) };
  if (
    key === "licenseNumber" ||
    (key === "number" && parentKey === "license")
  ) {
    return { replaced: true, value: MASKED_LICENSE_NUMBER };
  }
  return { replaced: false };
}

function walk(
  value: Json,
  ownerId: string,
  parentKey: string | undefined,
  depth: number,
): Json {
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, ownerId, parentKey, depth + 1));
  }
  if (!isPlainObject(value)) return value;
  // The account's own records stay whole (profile, license, registrations).
  if (value.id === ownerId || value.userId === ownerId) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const masked = maskValue(key, child, parentKey);
    out[key] = masked.replaced
      ? masked.value
      : walk(child, ownerId, key, depth + 1);
  }
  return out;
}

/** Returns a masked copy; the input is never mutated. */
export function maskPersonalData(value: Json, ownerId: string): Json {
  return walk(value, ownerId, undefined, 0);
}
