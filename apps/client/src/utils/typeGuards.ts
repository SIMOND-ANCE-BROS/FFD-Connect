/**
 * Utilitaires de validation et conversion de types
 * Permet d'éviter les casts `as any` dans les handlers d'événements
 */

export type MemberStatus = "ACTIVE" | "INACTIVE";

/**
 * Type guard pour valider MemberStatus
 */
export function isValidMemberStatus(value: string): value is MemberStatus {
  return ["ACTIVE", "INACTIVE"].includes(value);
}

/**
 * Convertit une string en MemberStatus de manière sécurisée
 */
export function toMemberStatus(value: string): MemberStatus {
  if (isValidMemberStatus(value)) {
    return value;
  }
  return "ACTIVE"; // Valeur par défaut
}

export type ThemePreference = "light" | "dark" | "system";

/**
 * Type guard pour valider ThemePreference
 */
export function isValidThemePreference(
  value: string,
): value is ThemePreference {
  return ["light", "dark", "system"].includes(value);
}

/**
 * Convertit une string en ThemePreference de manière sécurisée
 */
export function toThemePreference(value: string): ThemePreference {
  if (isValidThemePreference(value)) {
    return value;
  }
  return "system"; // Valeur par défaut
}

export type CompetitionFilter = "ALL" | "OPEN" | "DRAFT";

/**
 * Type guard pour valider CompetitionFilter
 */
export function isValidCompetitionFilter(
  value: string,
): value is CompetitionFilter {
  return ["ALL", "OPEN", "DRAFT"].includes(value);
}

/**
 * Convertit une string en CompetitionFilter de manière sécurisée
 */
export function toCompetitionFilter(value: string): CompetitionFilter {
  if (isValidCompetitionFilter(value)) {
    return value;
  }
  return "ALL"; // Valeur par défaut
}

/**
 * Type pour les données QR code actives
 */
export interface QrData {
  id?: string;
  type?: string;
  [key: string]: unknown;
}

/**
 * Type guard pour valider si un objet est un QrData avec type WDSF
 */
export function isWdsfQrData(data: unknown): data is QrData {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    (data as QrData).type === "WDSF" &&
    "id" in data &&
    typeof (data as QrData).id === "string"
  );
}

/**
 * Type guard pour valider si un objet est un QrData
 */
export function isQrData(data: unknown): data is QrData {
  return typeof data === "object" && data !== null;
}

/**
 * Type pour les propriétés étendues d'un track TrackPlayer
 */
export interface ExtendedTrackData {
  baseBpm?: number;
  style?: string;
  playlist?: string;
}

/**
 * Type guard pour vérifier si un track a des propriétés étendues
 */
export function hasExtendedTrackData(
  track: unknown,
): track is ExtendedTrackData {
  return typeof track === "object" && track !== null;
}
