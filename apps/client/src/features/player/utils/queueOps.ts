/**
 * Pure queue mutations for the music player.
 *
 * The queue is keyed by track id everywhere (FlatList keys, current-track
 * lookup, next/previous), so a track appears at most once: adding a track that
 * is already queued MOVES it instead of duplicating it. The currently playing
 * track is never moved by an add (that would desync the native player).
 *
 * Every function returns a new array (or the same reference when nothing
 * changes) so Zustand subscribers can rely on reference equality.
 */
import { TrackData } from "../types";

/** Outcome of adding a track to the queue, used for the user feedback. */
export type QueueAddResult = "started" | "queued" | "unchanged" | "failed";

export const removeTrackById = (
  queue: TrackData[],
  trackId: string,
): TrackData[] =>
  queue.some((t) => t.id === trackId)
    ? queue.filter((t) => t.id !== trackId)
    : queue;

/**
 * Inserts `track` right after the current track ("Lire ensuite"). Without a
 * current track (or if it is not in the queue) the track goes first.
 */
export const insertNext = (
  queue: TrackData[],
  track: TrackData,
  currentId: string | null,
): TrackData[] => {
  if (track.id === currentId) return queue;
  const rest = removeTrackById(queue, track.id);
  const currentIndex =
    currentId === null ? -1 : rest.findIndex((t) => t.id === currentId);
  const at = currentIndex + 1;
  return [...rest.slice(0, at), track, ...rest.slice(at)];
};

/** Appends `track` at the end of the queue ("Ajouter à la file"). */
export const appendTrack = (
  queue: TrackData[],
  track: TrackData,
  currentId: string | null,
): TrackData[] => {
  if (track.id === currentId) return queue;
  return [...removeTrackById(queue, track.id), track];
};

/**
 * Moves the track at index `from` to index `to` (drag-and-drop reorder).
 * Out-of-range or no-op moves return the queue unchanged.
 */
export const moveTrack = (
  queue: TrackData[],
  from: number,
  to: number,
): TrackData[] => {
  const inRange = (i: number) =>
    Number.isInteger(i) && i >= 0 && i < queue.length;
  if (from === to || !inRange(from) || !inRange(to)) return queue;
  const next = [...queue];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

/** Which library action added the track. */
export type QueueAddKind = "next" | "end";

/** Short confirmation shown after a queue action from the library. */
export const queueFeedbackMessage = (
  result: QueueAddResult,
  kind: QueueAddKind,
  title: string,
): string => {
  switch (result) {
    case "started":
      return `Lecture de « ${title} »`;
    case "queued":
      return kind === "next"
        ? `« ${title} » sera lu ensuite`
        : `« ${title} » ajouté à la file d'attente`;
    case "unchanged":
      return `« ${title} » est déjà en lecture`;
    case "failed":
      return `Impossible de lire « ${title} »`;
  }
};
