import { HttpException } from "@nestjs/common";

/** Convertit une valeur unknown en string de manière sûre (évite [object Object]). */
function toStr(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return "";
}

/** Noms d'affichage des fédérations (code API → libellé complet). */
export const FEDERATION_DISPLAY_NAMES: Record<string, string> = {
  FFD: "FFD - Fédération Française de Danse",
  FFDANSE: "FFD - Fédération Française de Danse",
  FRANCE: "FFD - Fédération Française de Danse",
  WDSF: "WDSF",
};

/** Libellé d'affichage de la fédération à partir du code renvoyé par l'API. */
export function getStructureDisplayName(code: string): string {
  if (!code) return "";
  const upper = code.toUpperCase().trim();
  return (
    FEDERATION_DISPLAY_NAMES[upper] ||
    FEDERATION_DISPLAY_NAMES[code.trim()] ||
    code
  );
}

/** Extrait une date de naissance (string ISO ou objet { year, month, day }). */
export function normalizeBirthDate(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "object" && "year" in value) {
    const o = value as { year?: number; month?: number; day?: number };
    const y = o.year ?? 0;
    const m = o.month ?? 1;
    const d = o.day ?? 1;
    if (y > 0)
      return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return "";
}

/** Extrait une URL de photo si l'API en renvoie une (non documentée dans le wiki). */
export function extractPhotoUrl(
  athlete: Record<string, unknown>,
): string | undefined {
  const keys = [
    "photoUrl",
    "pictureUrl",
    "imageUrl",
    "image",
    "photo",
    "avatar",
    "profileImage",
    "picture",
  ];
  for (const k of keys) {
    const v = athlete[k];
    if (typeof v === "string" && v.trim().startsWith("http")) return v.trim();
  }
  return undefined;
}

/** Extrait prénom ou nom depuis un champ "name" full name si nécessaire. */
export function parseNamePart(name: unknown, part: "first" | "last"): string {
  const s = typeof name === "string" ? name.trim() : "";
  if (!s) return "";
  const parts = s.split(/\s+/);
  if (part === "first") return parts[0] ?? "";
  return parts.length > 1 ? parts.slice(1).join(" ") : "";
}

/** Découpe un nom en mots comparables : sans accents, minuscules, tirets/apostrophes = espaces. */
export function nameTokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * Vrai si le nom WDSF correspond au prénom + nom du compte, quel que soit
 * l'ordre (« Gabin Simond » comme « Simond Gabin »). Chaque mot du prénom et
 * du nom doit figurer dans le nom WDSF ; un deuxième prénom côté WDSF est toléré.
 */
export function wdsfNameMatches(
  wdsfFullName: string,
  firstName: string,
  lastName: string,
): boolean {
  const wdsf = new Set(nameTokens(wdsfFullName));
  const first = nameTokens(firstName);
  const last = nameTokens(lastName);
  if (wdsf.size === 0 || first.length === 0 || last.length === 0) return false;
  return [...first, ...last].every((token) => wdsf.has(token));
}

/**
 * Parse la réponse WDSF (array, objet wrapper, ou objet personne unique) et mappe vers le format attendu.
 */
export function parsePersonsToAthlete(
  data: unknown,
  min: string,
): {
  firstName: string;
  lastName: string;
  licenseNumber: string;
  birthDate: string;
  country: string;
  status: string;
  type: string;
  structure: string;
  validUntil: string;
  ageGroup: string;
  gender: string;
  partnerName?: string;
  partnerAgeGroup?: string;
  photoUrl?: string;
} {
  let persons: unknown[] = Array.isArray(data) ? data : [];
  if (!Array.isArray(data) && data && typeof data === "object") {
    const wrapped = data as {
      persons?: unknown[];
      data?: unknown[];
      items?: unknown[];
      id?: unknown;
      min?: unknown;
      name?: unknown;
    };
    persons = wrapped.persons ?? wrapped.data ?? wrapped.items ?? [];
    if (
      persons.length === 0 &&
      (wrapped.id != null || wrapped.min != null || wrapped.name != null)
    ) {
      persons = [data];
    }
  }
  if (persons.length === 0) {
    throw new HttpException(
      {
        message: "Numéro MIN invalide ou introuvable.",
        code: "WDSF_ATHLETE_NOT_FOUND",
      },
      404,
    );
  }
  const raw = persons[0] as Record<string, unknown>;
  const athleteMin = toStr(raw.min) || toStr(raw.id) || min;
  const athlete =
    (persons.find(
      (p) =>
        String(
          (p as Record<string, unknown>).min ??
            (p as Record<string, unknown>).id,
        ) === min,
    ) as Record<string, unknown> | undefined) ?? raw;
  const countryObj = athlete.country as { name?: string } | undefined;
  const countryStr =
    typeof countryObj === "object" && countryObj.name != null
      ? countryObj.name
      : toStr(athlete.country) || toStr(athlete.nationality);
  const licenses = athlete.licenses as
    | Array<{ type?: string; status?: string; expiresOn?: string }>
    | undefined;
  const firstLicense =
    Array.isArray(licenses) && licenses.length > 0 ? licenses[0] : undefined;
  const expiresOn = firstLicense?.expiresOn;
  const validUntil =
    typeof expiresOn === "string" && expiresOn ? expiresOn : "Active";
  const licenseType =
    firstLicense?.type && String(firstLicense.type).trim()
      ? String(firstLicense.type)
      : "Athlete's License";
  const activePartner = athlete.activePartner;
  const partnerName =
    typeof activePartner === "string" && activePartner.trim()
      ? activePartner.trim()
      : undefined;
  const activeCoupleAgeGroup = athlete.activeCoupleAgeGroup;
  const partnerAgeGroup =
    typeof activeCoupleAgeGroup === "string" && activeCoupleAgeGroup.trim()
      ? activeCoupleAgeGroup.trim()
      : undefined;
  const birthDateRaw =
    athlete.birthDate ??
    athlete.birthdate ??
    athlete.dateOfBirth ??
    athlete.birth;
  const birthDateStr = normalizeBirthDate(birthDateRaw);
  const memberBodyName = (athlete.memberBody as { name?: string } | undefined)
    ?.name;
  const structureCode = memberBodyName?.trim() ?? "";
  let structure = getStructureDisplayName(structureCode) || "WDSF";
  const countryUpper = countryStr.toUpperCase();
  if (
    (structure === "WDSF" || !structureCode) &&
    (countryUpper === "FRANCE" || countryUpper === "FRA")
  ) {
    structure = FEDERATION_DISPLAY_NAMES.FFD;
  }
  const photoUrl = extractPhotoUrl(athlete);
  return {
    // "name" is the full name ("Gabin Simond"): never use it as the first name,
    // it would be rendered as "Gabin Simond Simond" next to the parsed last name.
    firstName:
      toStr(athlete.firstName).trim() || parseNamePart(athlete.name, "first"),
    lastName:
      (toStr(athlete.lastName) || toStr(athlete.surname)).trim() ||
      parseNamePart(athlete.name, "last"),
    licenseNumber: athleteMin,
    birthDate: birthDateStr,
    country: countryStr,
    status: toStr(firstLicense?.status) || toStr(athlete.status) || "Active",
    type: licenseType,
    structure,
    validUntil: validUntil,
    ageGroup: toStr(athlete.ageGroup) || toStr(athlete.age),
    gender: toStr(athlete.gender) || toStr(athlete.sex),
    partnerName,
    partnerAgeGroup,
    photoUrl,
  };
}
