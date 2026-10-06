import type {
  TrackCorrectionAdminDto,
  TrackCorrectionReason,
  TrackCorrectionStatus,
} from "../../../services/api/track-correction-api";

/** Motifs proposés à l'utilisateur, dans l'ordre d'affichage. */
export const CORRECTION_REASONS: {
  value: TrackCorrectionReason;
  label: string;
}[] = [
  { value: "TITLE", label: "Titre" },
  { value: "ARTIST", label: "Artiste" },
  { value: "DANCE", label: "Danse (catégorie)" },
  { value: "MPM", label: "MPM" },
  { value: "PASO_CLASH", label: "Clashs paso doble" },
  { value: "OTHER", label: "Autre" },
];

export function reasonLabel(reason: TrackCorrectionReason): string {
  return CORRECTION_REASONS.find((r) => r.value === reason)?.label ?? reason;
}

export const STATUS_LABELS: Record<TrackCorrectionStatus, string> = {
  PENDING: "En attente",
  APPROVED: "Validée",
  REJECTED: "Refusée",
};

/** Bornes du backend (CreateTrackCorrectionDto). */
export const MPM_MIN = 1;
export const MPM_MAX = 400;
export const CLASH_MAX_COUNT = 10;
export const CLASH_MAX_SECONDS = 3600;
export const MESSAGE_MAX_LENGTH = 500;

/** 83.5 → « 1:23 » (dixièmes ignorés à l'affichage). */
export function formatClashTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

/** [12, 83.5] → « 0:12, 1:23 » ; liste vide → « aucun ». */
export function formatClashList(clashes: readonly number[]): string {
  if (clashes.length === 0) return "aucun";
  return [...clashes]
    .sort((a, b) => a - b)
    .map(formatClashTime)
    .join(", ");
}

/**
 * « 0:12, 1:23 » (ou secondes brutes « 12, 83.5 ») → [12, 83] triés.
 * `null` si un élément est illisible ou hors bornes. Chaîne vide → [].
 */
export function parseClashList(input: string): number[] | null {
  const parts = input
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const values: number[] = [];
  for (const part of parts) {
    const mmss = /^(\d{1,3}):([0-5]\d)(?:[.,](\d))?$/.exec(part);
    let value: number;
    if (mmss) {
      value =
        Number(mmss[1]) * 60 +
        Number(mmss[2]) +
        (mmss[3] ? Number(mmss[3]) / 10 : 0);
    } else if (/^\d+(?:\.\d+)?$/.test(part)) {
      value = Number(part);
    } else {
      return null;
    }
    if (value < 0 || value > CLASH_MAX_SECONDS) return null;
    values.push(value);
  }
  if (values.length > CLASH_MAX_COUNT) return null;
  return values.sort((a, b) => a - b);
}

/** Lit un MPM saisi : entier dans les bornes du backend, sinon `null`. */
export function parseMpm(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= MPM_MIN && n <= MPM_MAX ? n : null;
}

export type CorrectionField = "title" | "artist" | "style" | "bpm" | "clash";

export interface CorrectionDiffLine {
  field: CorrectionField;
  label: string;
  current: string;
  proposed: string;
}

/**
 * Lignes « actuel → proposé » d'une proposition. Seuls les champs proposés
 * (non nuls) apparaissent : le backend ne retient que ce qui diffère.
 */
export function buildCorrectionDiff(
  item: Pick<TrackCorrectionAdminDto, "proposed" | "track">,
): CorrectionDiffLine[] {
  const { proposed, track } = item;
  const lines: CorrectionDiffLine[] = [];
  if (proposed.title !== null) {
    lines.push({
      field: "title",
      label: "Titre",
      current: track.title,
      proposed: proposed.title,
    });
  }
  if (proposed.artist !== null) {
    lines.push({
      field: "artist",
      label: "Artiste",
      current: track.artist,
      proposed: proposed.artist,
    });
  }
  if (proposed.style !== null) {
    lines.push({
      field: "style",
      label: "Danse",
      current: track.style ?? "—",
      proposed: proposed.style,
    });
  }
  if (proposed.bpm !== null) {
    lines.push({
      field: "bpm",
      label: "MPM",
      current: String(track.bpm),
      proposed: String(proposed.bpm),
    });
  }
  if (proposed.clashTimecodes !== null) {
    lines.push({
      field: "clash",
      label: "Clashs",
      current: formatClashList(track.clashTimecodes),
      proposed: formatClashList(proposed.clashTimecodes),
    });
  }
  return lines;
}

/** Date courte « 6 oct. 2026 ». */
export function formatCorrectionDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
