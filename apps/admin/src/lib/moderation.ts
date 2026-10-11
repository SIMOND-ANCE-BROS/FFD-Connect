import type {
  ApproveTrackCorrectionDto,
  TrackCorrectionAdminDto,
  TrackCorrectionReason,
  TrackCorrectionStatus,
} from '../api/generated/types.gen';
import type { ModerationFilter } from '../api/queries';
import { API_ORIGIN } from '../config';

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
  /** One track's proposals (link from the track page); absent: every track. */
  trackId?: string;
}

const isStatus = (value: string | null): value is TrackCorrectionStatus =>
  STATUS_OPTIONS.some((o) => o.value === value);

const isReason = (value: string): value is TrackCorrectionReason =>
  (REASONS as string[]).includes(value);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filters kept in the URL: `?status=APPROVED&reason=MPM,TITLE&q=paso&page=2&track=<uuid>`. */
export function readModerationParams(params: URLSearchParams): ModerationUrlState {
  const status = params.get('status');
  const q = (params.get('q') ?? '').trim();
  const page = Number(params.get('page'));
  const track = params.get('track') ?? '';
  return {
    status: isStatus(status) ? status : 'PENDING',
    reasons: (params.get('reason') ?? '').split(',').filter(isReason),
    q: q.length >= MIN_SEARCH_LENGTH ? q : '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
    ...(UUID.test(track) && { trackId: track }),
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
  if (next.trackId) params.set('track', next.trackId);
  return params;
}

/** API filter of one list page of `take` rows. */
export function moderationFilter(state: ModerationUrlState, take: number): ModerationFilter {
  return {
    status: state.status,
    ...(state.reasons.length > 0 && { reason: state.reasons }),
    ...(state.q && { q: state.q }),
    ...(state.trackId && { trackId: state.trackId }),
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

/** Reply templates: inserted in the comment, still editable. Not stored server-side. */
export const REJECT_TEMPLATES = [
  'Déjà corrigé',
  'Valeur incorrecte',
  "Doublon d'une autre proposition",
] as const;
export const APPROVE_TEMPLATES = ["Merci, c'est corrigé"] as const;

/** Fills an empty comment with the template, or appends it on a new line. */
export const insertTemplate = (comment: string, template: string): string =>
  comment.trim() ? `${comment.trimEnd()}\n${template}` : template;

/** Editable values of a pending proposal (`bpm` is '' while the input is empty). */
export interface ReviewValues {
  title: string;
  artist: string;
  style: string;
  bpm: number | string;
  clashes: number[];
}

/** The proposed value of each field, or the current one when nothing is proposed. */
export function initialReviewValues(c: TrackCorrectionAdminDto): ReviewValues {
  return {
    title: c.proposed.title ?? c.track.title,
    artist: c.proposed.artist ?? c.track.artist,
    style: c.proposed.style ?? c.track.style ?? '',
    bpm: c.proposed.bpm ?? c.resultingBpm,
    clashes: c.proposed.clashTimecodes ?? c.track.clashTimecodes,
  };
}

export type ApproveOverrides = Pick<
  ApproveTrackCorrectionDto,
  'title' | 'artist' | 'style' | 'bpm' | 'clashTimecodes'
>;

const sortedNumbers = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b);

/** Same normalisation as the server on write: sorted, no duplicate. */
export const sortedUnique = (values: readonly number[]): number[] =>
  [...new Set(values)].sort((a, b) => a - b);

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean => {
  const x = sortedNumbers(a);
  const y = sortedNumbers(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/**
 * Approve body: only what the admin changed. An absent field keeps the
 * proposal's value server-side; an emptied clash list is sent as `[]`
 * (« aucun clash »), an untouched one is not sent; a blanked text field or an
 * empty MPM is never sent.
 */
export function approveOverrides(initial: ReviewValues, values: ReviewValues): ApproveOverrides {
  const body: ApproveOverrides = {};
  for (const key of ['title', 'artist', 'style'] as const) {
    const text = values[key].trim();
    if (text && text !== initial[key]) body[key] = text;
  }
  if (typeof values.bpm === 'number' && values.bpm !== initial.bpm) body.bpm = values.bpm;
  if (!sameNumbers(values.clashes, initial.clashes)) {
    body.clashTimecodes = sortedNumbers(values.clashes);
  }
  return body;
}

const RECOMPUTED_BPM = 'recalculé selon la danse';

/**
 * Before → after of the track if approved with these overrides, changed
 * fields only. A dance override with neither an admin nor a proposed MPM makes
 * the server recalculate the MPM from the raw tempo, which the SPA cannot know
 * (nor whether the track has one: then the MPM simply stays).
 */
export function approvalPreview(
  c: TrackCorrectionAdminDto,
  overrides: ApproveOverrides,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const { track: t, proposed: p } = c;
  const current: Record<string, unknown> = {
    title: t.title,
    artist: t.artist,
    style: t.style,
    bpm: t.bpm,
    clashTimecodes: t.clashTimecodes,
  };
  const result: Record<string, unknown> = {
    title: overrides.title ?? p.title ?? t.title,
    artist: overrides.artist ?? p.artist ?? t.artist,
    style: overrides.style ?? p.style ?? t.style,
    // Server: `dto.bpm ?? proposedBpm` is applied as is; only a dance override
    // with no MPM anywhere makes it recalculate from the raw tempo.
    bpm:
      overrides.bpm ?? p.bpm ?? (overrides.style !== undefined ? RECOMPUTED_BPM : c.resultingBpm),
    clashTimecodes: sortedUnique(overrides.clashTimecodes ?? p.clashTimecodes ?? t.clashTimecodes),
  };
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of Object.keys(result)) {
    if (JSON.stringify(result[key]) !== JSON.stringify(current[key])) {
      before[key] = current[key];
      after[key] = result[key];
    }
  }
  return { before, after };
}

/** Same URL as the mobile player: `/uploads` is served outside `/api/v1`. */
export const trackAudioUrl = (filename: string): string =>
  `${API_ORIGIN}/uploads/${encodeURIComponent(filename)}`;
