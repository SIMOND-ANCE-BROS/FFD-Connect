import { DANCE_GROUPS } from "../../player/utils/danceTempo";
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

/**
 * 83.5 → « 1:23.5 », 83 → « 1:23 » : format d'édition, sans perte des
 * dixièmes (relu tel quel par `parseClashList`).
 */
export function formatClashTimePrecise(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  const whole = Math.floor(tenths / 10);
  const rest = tenths % 10;
  return rest === 0
    ? formatClashTime(whole)
    : `${formatClashTime(whole)}.${rest}`;
}

/** Liste éditable « 0:12, 1:23.5 » (chaîne vide si aucun appel). */
export function formatClashListForEdit(clashes: readonly number[]): string {
  return [...clashes]
    .sort((a, b) => a - b)
    .map(formatClashTimePrecise)
    .join(", ");
}

/** Deux listes de clashs identiques au dixième près (ordre indifférent). */
export function sameClashes(
  a: readonly number[],
  b: readonly number[],
): boolean {
  if (a.length !== b.length) return false;
  const norm = (l: readonly number[]) =>
    [...l].map((v) => Math.round(v * 10)).sort((x, y) => x - y);
  const nb = norm(b);
  return norm(a).every((v, i) => v === nb[i]);
}

/** Même danse, sans tenir compte de la casse ni des espaces (comme le backend). */
export function sameDance(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/** Libellé canonique de la liste des danses (« rumba » → « Rumba »). */
export function canonicalDance(
  style: string | null | undefined,
): string | null {
  if (!style) return null;
  const match = DANCE_GROUPS.flatMap((g) => g.dances).find((d) =>
    sameDance(d, style),
  );
  return match ?? style;
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

export type CorrectionField =
  | "title"
  | "artist"
  | "style"
  | "bpm"
  | "resultingBpm"
  | "clash";

export interface CorrectionDiffLine {
  field: CorrectionField;
  label: string;
  current: string;
  proposed: string;
}

/** Vrai si la proposition change la danse sans proposer de MPM. */
export function isDanceOnlyChange(
  item: Pick<TrackCorrectionAdminDto, "proposed">,
): boolean {
  return item.proposed.style !== null && item.proposed.bpm === null;
}

/**
 * Lignes « actuel → proposé » d'une proposition. Seuls les champs proposés
 * (non nuls) apparaissent : le backend ne retient que ce qui diffère. Un
 * changement de danse seul recalcule le MPM : on affiche alors le MPM qui
 * résultera de la validation (`resultingBpm`, calculé par le backend).
 */
export function buildCorrectionDiff(
  item: Pick<TrackCorrectionAdminDto, "proposed" | "track" | "resultingBpm">,
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
  if (isDanceOnlyChange(item)) {
    lines.push({
      field: "resultingBpm",
      label: "MPM recalculé",
      current: String(Math.round(track.bpm)),
      proposed: String(Math.round(item.resultingBpm)),
    });
  }
  if (proposed.bpm !== null) {
    lines.push({
      field: "bpm",
      label: "MPM",
      current: String(Math.round(track.bpm)),
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
