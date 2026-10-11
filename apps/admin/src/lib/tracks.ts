import type {
  AdminTrackDto,
  AdminTracksControllerCreateData,
  TrackStatus,
  UpdateTrackDto,
} from '../api/generated/types.gen';
import type { TracksFilter } from '../api/queries';
import { MIN_SEARCH_LENGTH, sortedUnique, trackAudioUrl } from './moderation';
import { bpmForPatch } from './mpm';

/** Import style options: the backend's TRACK_STYLE_OPTIONS, as the generated union. */
export type StyleOption = NonNullable<AdminTracksControllerCreateData['body']['style']>;

/**
 * Exactly the generated union: a dance added, renamed or removed on the
 * backend fails the typecheck here (missing or unknown key).
 */
const STYLE_SET: Record<StyleOption, true> = {
  'Valse Lente': true,
  Tango: true,
  'Valse Viennoise': true,
  Quickstep: true,
  'Slow Fox': true,
  Samba: true,
  'Cha-cha': true,
  Rumba: true,
  'Paso Doble': true,
  Jive: true,
  Ambiance: true,
};

export const AMBIANCE: StyleOption = 'Ambiance';
/** The canonical dances then « Ambiance », in the backend order. */
export const STYLE_OPTIONS = Object.keys(STYLE_SET) as StyleOption[];
export const DANCE_LABELS: StyleOption[] = STYLE_OPTIONS.filter((s) => s !== AMBIANCE);

export const TRACK_STATUS_BADGES: Record<TrackStatus, { label: string; color: string }> = {
  READY: { label: 'Prête', color: 'green' },
  PENDING: { label: 'En attente', color: 'yellow' },
  ERROR: { label: 'En erreur', color: 'red' },
};

export const TRACK_STATUS_FILTERS: { value: TrackStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Toutes' },
  { value: 'READY', label: 'Prêtes' },
  { value: 'PENDING', label: 'En attente' },
  { value: 'ERROR', label: 'En erreur' },
];

/** The API refuses a longer search (400). */
export const MAX_SEARCH_LENGTH = 100;

export interface TracksUrlState {
  q: string;
  status: TrackStatus | null;
  blacklisted: boolean;
  titleMasked: boolean;
  ambiance: boolean;
  style: string;
  page: number;
}

const STATUSES: TrackStatus[] = ['READY', 'PENDING', 'ERROR'];
const isStatus = (value: string | null): value is TrackStatus =>
  STATUSES.some((status) => status === value);

/**
 * Filters kept in the URL:
 * `?q=paso&status=ERROR&blacklisted=true&titleMasked=true&ambiance=true&style=Rumba&page=2`.
 */
export function readTracksParams(params: URLSearchParams): TracksUrlState {
  const status = params.get('status');
  const q = (params.get('q') ?? '').trim().slice(0, MAX_SEARCH_LENGTH);
  const style = params.get('style') ?? '';
  const page = Number(params.get('page'));
  return {
    q: q.length >= MIN_SEARCH_LENGTH ? q : '',
    status: isStatus(status) ? status : null,
    blacklisted: params.get('blacklisted') === 'true',
    titleMasked: params.get('titleMasked') === 'true',
    ambiance: params.get('ambiance') === 'true',
    style: DANCE_LABELS.some((dance) => dance === style) ? style : '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** New params with `patch` applied; any filter change goes back to the first page. */
export function writeTracksParams(
  current: URLSearchParams,
  patch: Partial<TracksUrlState>,
): URLSearchParams {
  const next = { ...readTracksParams(current), ...patch };
  if (patch.page === undefined) next.page = 1;
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.status) params.set('status', next.status);
  if (next.blacklisted) params.set('blacklisted', 'true');
  if (next.titleMasked) params.set('titleMasked', 'true');
  if (next.ambiance) params.set('ambiance', 'true');
  if (next.style) params.set('style', next.style);
  if (next.page > 1) params.set('page', String(next.page));
  return params;
}

/** API filter of one list page of `take` rows; a chip only ever filters on `true`. */
export function tracksFilter(state: TracksUrlState, take: number): TracksFilter {
  return {
    ...(state.q && { q: state.q }),
    ...(state.status && { status: state.status }),
    ...(state.blacklisted && { blacklisted: true }),
    ...(state.titleMasked && { titleMasked: true }),
    ...(state.ambiance && { ambiance: true }),
    ...(state.style && { style: state.style }),
    skip: (state.page - 1) * take,
    take,
  };
}

/** Editable values of the track page (`bpm` is '' while the input is empty). */
export interface TrackEditValues {
  title: string;
  artist: string;
  style: string;
  bpm: number | string;
  clashes: number[];
}

export const initialEditValues = (t: AdminTrackDto): TrackEditValues => ({
  title: t.title,
  artist: t.artist,
  style: t.style ?? '',
  bpm: t.bpm,
  clashes: t.clashTimecodes,
});

export type TrackPatch = Pick<
  UpdateTrackDto,
  'title' | 'artist' | 'style' | 'bpm' | 'clashTimecodes'
>;

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean =>
  JSON.stringify(sortedUnique(a)) === JSON.stringify(sortedUnique(b));

/**
 * PATCH /tracks/:id body: changed fields only. The MPM goes only when the
 * admin typed one (also when it equals the current value while the dance
 * changes: it then prevails over the recalculation); a dance change alone
 * lets the server recompute it from the raw tempo, as the preview shows. A
 * blanked text field is never sent; an empty style clears the dance.
 */
export function trackPatch(
  t: AdminTrackDto,
  values: TrackEditValues,
  bpmTouched: boolean,
): TrackPatch {
  const body: TrackPatch = {};
  const title = values.title.trim();
  if (title && title !== t.title) body.title = title;
  const artist = values.artist.trim();
  if (artist && artist !== t.artist) body.artist = artist;
  if (values.style !== (t.style ?? '')) body.style = values.style;
  if (
    bpmTouched &&
    typeof values.bpm === 'number' &&
    (values.bpm !== t.bpm || body.style !== undefined)
  ) {
    body.bpm = values.bpm;
  }
  if (!sameNumbers(values.clashes, t.clashTimecodes)) {
    body.clashTimecodes = sortedUnique(values.clashes);
  }
  return body;
}

/** MPM after this PATCH, computed as the server does (TracksService.bpmForPatch). */
export const resultingBpm = (t: AdminTrackDto, patch: TrackPatch): number =>
  bpmForPatch(t.rawBpm, patch) ?? t.bpm;

/** Before → after of the confirmation, as the server will apply it (status included). */
export function trackChangePreview(
  t: AdminTrackDto,
  patch: TrackPatch,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const set = (key: string, from: unknown, to: unknown) => {
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      before[key] = from;
      after[key] = to;
    }
  };
  if (patch.title !== undefined) set('title', t.title, patch.title);
  if (patch.artist !== undefined) set('artist', t.artist, patch.artist);
  if (patch.style !== undefined) set('style', t.style, patch.style || null);
  const bpm = bpmForPatch(t.rawBpm, patch);
  if (bpm !== undefined) set('bpm', t.bpm, bpm);
  if (patch.clashTimecodes !== undefined) {
    set('clashTimecodes', t.clashTimecodes, patch.clashTimecodes);
  }
  // Server rule: an admin MPM > 0 publishes a track the import left in ERROR.
  if (t.status === 'ERROR' && bpm !== undefined && bpm > 0) set('status', t.status, 'READY');
  return { before, after };
}

/** The typed title confirms a deletion: case and surrounding spaces ignored. */
export const titleConfirms = (typed: string, title: string): boolean =>
  typed.trim() !== '' && typed.trim().toLowerCase() === title.trim().toLowerCase();

/** Same URL scheme as the audio file: `/uploads` is served outside `/api/v1`. */
export const trackArtworkUrl = (artwork: string): string => trackAudioUrl(artwork);
