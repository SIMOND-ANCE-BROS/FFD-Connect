import type {
  TrackCorrectionAdminDto,
  TrackCorrectionReason,
  TrackCorrectionStatus,
} from '../api/generated/types.gen';
import type { ModerationFilter } from '../api/queries';

export const REASON_LABELS: Record<TrackCorrectionReason, string> = {
  TITLE: 'Titre',
  ARTIST: 'Artiste',
  DANCE: 'Danse',
  MPM: 'MPM',
  PASO_CLASH: 'Clashes paso',
  OTHER: 'Autre',
};

export const REASONS = Object.keys(REASON_LABELS) as TrackCorrectionReason[];

export const STATUS_OPTIONS: { value: TrackCorrectionStatus; label: string }[] = [
  { value: 'PENDING', label: 'À traiter' },
  { value: 'APPROVED', label: 'Approuvées' },
  { value: 'REJECTED', label: 'Refusées' },
];

export const STATUS_BADGES: Record<TrackCorrectionStatus, { label: string; color: string }> = {
  PENDING: { label: 'À traiter', color: 'yellow' },
  APPROVED: { label: 'Approuvée', color: 'green' },
  REJECTED: { label: 'Refusée', color: 'red' },
};

/** The API refuses a shorter search (400): the SPA never sends one. */
export const MIN_SEARCH_LENGTH = 2;
/** Same bounds as the API (a paso doble has 2 or 3 clashes). */
export const MAX_CLASHES = 3;
export const MAX_CLASH_SECONDS = 3600;

export interface ModerationUrlState {
  status: TrackCorrectionStatus;
  reasons: TrackCorrectionReason[];
  q: string;
  page: number;
}

const isStatus = (value: string | null): value is TrackCorrectionStatus =>
  STATUS_OPTIONS.some((o) => o.value === value);

const isReason = (value: string): value is TrackCorrectionReason =>
  (REASONS as string[]).includes(value);

/** Filters kept in the URL: `?status=APPROVED&reason=MPM,TITLE&q=paso&page=2`. */
export function readModerationParams(params: URLSearchParams): ModerationUrlState {
  const status = params.get('status');
  const q = (params.get('q') ?? '').trim();
  const page = Number(params.get('page'));
  return {
    status: isStatus(status) ? status : 'PENDING',
    reasons: (params.get('reason') ?? '').split(',').filter(isReason),
    q: q.length >= MIN_SEARCH_LENGTH ? q : '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** New params with `patch` applied; any filter change goes back to the first page. */
export function writeModerationParams(
  current: URLSearchParams,
  patch: Partial<ModerationUrlState>,
): URLSearchParams {
  const next = { ...readModerationParams(current), ...patch };
  if (patch.page === undefined) next.page = 1;
  const params = new URLSearchParams();
  if (next.status !== 'PENDING') params.set('status', next.status);
  if (next.reasons.length > 0) params.set('reason', next.reasons.join(','));
  if (next.q) params.set('q', next.q);
  if (next.page > 1) params.set('page', String(next.page));
  return params;
}

/** API filter of one list page of `take` rows. */
export function moderationFilter(state: ModerationUrlState, take: number): ModerationFilter {
  return {
    status: state.status,
    ...(state.reasons.length > 0 && { reason: state.reasons }),
    ...(state.q && { q: state.q }),
    skip: (state.page - 1) * take,
    take,
  };
}

/**
 * « Proposition suivante »: the oldest pending proposal matching the list's
 * reasons and search, whatever status and page the list shows.
 */
export const nextPendingFilter = (params: URLSearchParams): ModerationFilter =>
  moderationFilter({ ...readModerationParams(params), status: 'PENDING', page: 1 }, 1);

/** Rounded to the tenth of a second, the precision of « Marquer ici ». */
export const roundTenth = (seconds: number): number => Math.round(seconds * 10) / 10;

/** `m:ss`, plus `.d` when the tenth is not zero: 83.46 → "1:23.5", 40 → "0:40". */
export function formatTimecode(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = tenths - minutes * 600;
  const secs = Math.floor(rest / 10);
  const tenth = rest % 10;
  return `${minutes}:${String(secs).padStart(2, '0')}${tenth ? `.${tenth}` : ''}`;
}

/** Accepts `m:ss`, `m:ss.d` (or `,d`) and plain seconds; null if invalid or beyond 3600 s. */
export function parseTimecode(text: string): number | null {
  const value = text.trim();
  const clock = /^(\d+):([0-5]\d)(?:[.,](\d))?$/.exec(value);
  const plain = /^(\d+)(?:[.,](\d))?$/.exec(value);
  let seconds: number;
  if (clock) {
    seconds = Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3] ?? 0) / 10;
  } else if (plain) {
    seconds = Number(plain[1]) + Number(plain[2] ?? 0) / 10;
  } else {
    return null;
  }
  return seconds <= MAX_CLASH_SECONDS ? roundTenth(seconds) : null;
}

/** One-line summary of the proposed values, for the queue table. */
export function proposalSummary(p: TrackCorrectionAdminDto['proposed']): string {
  const parts: string[] = [];
  if (p.title !== null) parts.push(`Titre « ${p.title} »`);
  if (p.artist !== null) parts.push(`Artiste « ${p.artist} »`);
  if (p.style !== null) parts.push(`Danse ${p.style}`);
  if (p.bpm !== null) parts.push(`MPM ${p.bpm}`);
  if (p.clashTimecodes !== null) {
    parts.push(
      p.clashTimecodes.length > 0
        ? `Clashes ${p.clashTimecodes.map(formatTimecode).join(', ')}`
        : 'Aucun clash',
    );
  }
  return parts.length > 0 ? parts.join(' · ') : 'Message seul';
}
