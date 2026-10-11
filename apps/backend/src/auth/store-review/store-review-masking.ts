/**
 * Personal-data masking of the responses served to a store-review account.
 *
 * That account is ADMIN with every extra role (so reviewers see every screen)
 * and its password is shared with Apple / Google. Its writes are simulated,
 * but its reads would expose other people's data. Every JSON response it
 * gets goes through `maskPersonalData`, DENY BY DEFAULT for people:
 *
 * - a PERSON record (any object carrying a name, email, phone or birth-date
 *   key) that is not the account itself keeps only the ALLOWLISTED fields
 *   (`PERSON_SAFE_KEYS`; last name cut to an initial). Every other primitive
 *   field is blanked (null, or a placeholder for email-like keys), whatever
 *   its name; nested objects are walked with the same rules;
 * - any other record not owned by the account has its sensitive keys blanked
 *   (contact data, birth dates, license numbers and QR codes, documents, free
 *   text, IPs: `SENSITIVE_KEY`) and every string that contains an email
 *   address masked (catches alternate names and JSON-in-string payloads);
 * - the account's own records are left whole, so its profile, E-licence QR
 *   and Wallet pass keep working. Ownership: an object whose `id` (person
 *   record) or `userId` is the account's id; a record with neither inherits
 *   its parent's ownership, but a nested person record is always judged on its
 *   own id (a partner inside the account's registration is masked).
 *
 * Endpoints that cannot be masked field by field (admin user list, audit
 * log) are not served at all to this account: see @StoreReviewRead. Routes
 * that serve the account's own data are marked @StoreReviewOwnData.
 */

export const MASKED_EMAIL = "masque@exemple.invalid";
const MASKED_LICENSE_NUMBER = "••••••";

/** Keys that make an object a person record. */
const PERSON_MARKER =
  /^(e-?mail|mail|contactEmail|firstName|lastName|fullName|birthDate|dateOfBirth|phone|phoneNumber|mobile)$/i;

/** The only fields of someone else's person record that are served as is. */
const PERSON_SAFE_KEYS: ReadonlySet<string> = new Set([
  "id",
  "firstName",
  "role",
  "roles",
  "extraRoles",
  "clubId",
  "clubName",
  "category",
  "ageGroup",
  "competitionLevel",
  "passportLevelLatin",
  "passportLevelStandard",
  "licenseStatus",
  "status",
  "isStoreReview",
  "disabledAt",
  "createdAt",
  "updatedAt",
]);

/** Sensitive keys blanked in any record that is not the account's. */
const SENSITIVE_KEY =
  /mail|phone|mobile|birth|address|street|postal|zip|password|token|secret|signature|^ip$|^wdsfMin$|^qrCode$|^filePath$|^ocrData$|^message$|^comment$|^reason$|^licenseNumber$/i;

const EMAIL_IN_TEXT = /[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+\.[^\s@"'<>(),;:]+/g;

/** Guard against pathological nesting (JSON columns). */
const MAX_DEPTH = 25;

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

const isContainer = (v: unknown): boolean =>
  Array.isArray(v) || isPlainObject(v);

const initial = (name: unknown): unknown =>
  typeof name === "string" && name.trim()
    ? `${name.trim().charAt(0).toUpperCase()}.`
    : null;

const isPersonRecord = (o: Record<string, unknown>): boolean =>
  Object.keys(o).some((k) => PERSON_MARKER.test(k));

const blank = (key: string, value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  return /mail/i.test(key) && typeof value === "string" ? MASKED_EMAIL : null;
};

interface Walk {
  ownerId: string;
  depth: number;
}

function ownedOf(
  o: Record<string, unknown>,
  ownerId: string,
  parentOwned: boolean,
): boolean {
  if (isPersonRecord(o) && typeof o.id === "string") return o.id === ownerId;
  if (typeof o.userId === "string") return o.userId === ownerId;
  return parentOwned;
}

/** Someone else's person record: allowlist, deny by default. */
function maskPersonField(key: string, child: unknown, w: Walk): unknown {
  if (key === "lastName") return initial(child);
  if (PERSON_SAFE_KEYS.has(key)) return walk(child, key, false, w);
  // Nested relations (license, club, registrations…) are masked in turn.
  if (isContainer(child) && !SENSITIVE_KEY.test(key)) {
    return walk(child, key, false, w);
  }
  return blank(key, child);
}

/** Any other record that is not the account's: sensitive keys blanked. */
function maskRecordField(
  key: string,
  child: unknown,
  parentKey: string | undefined,
  w: Walk,
): unknown {
  if (SENSITIVE_KEY.test(key)) return blank(key, child);
  if (key === "number" && parentKey === "license" && child !== null) {
    return MASKED_LICENSE_NUMBER;
  }
  return walk(child, key, false, w);
}

function walk(
  value: unknown,
  parentKey: string | undefined,
  parentOwned: boolean,
  w: Walk,
): unknown {
  if (w.depth > MAX_DEPTH) return parentOwned ? value : null;
  const next = { ...w, depth: w.depth + 1 };
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, parentKey, parentOwned, next));
  }
  if (typeof value === "string") {
    return parentOwned ? value : value.replace(EMAIL_IN_TEXT, MASKED_EMAIL);
  }
  if (!isPlainObject(value)) return value;

  const owned = ownedOf(value, w.ownerId, parentOwned);
  const person = !owned && isPersonRecord(value);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = owned
      ? walk(child, key, true, next)
      : person
        ? maskPersonField(key, child, next)
        : maskRecordField(key, child, parentKey, next);
  }
  return out;
}

/**
 * Returns a masked copy; the input is never mutated. `ownedRoot`: the route
 * serves the account's own data (@StoreReviewOwnData), so records without an
 * owner field start as owned; nested person records are still judged on their
 * own id.
 */
export function maskPersonalData(
  value: unknown,
  ownerId: string,
  ownedRoot = false,
): unknown {
  return walk(value, undefined, ownedRoot, { ownerId, depth: 0 });
}
