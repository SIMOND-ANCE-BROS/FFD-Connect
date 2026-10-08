// Barrel export — single entry point for all stores.
// Components import from 'stores/', never from 'stores/auth.store' directly.

export { useAuthStore } from "./auth.store";

export { useNotificationPreferencesStore } from "./notificationPreferences.store";

export {
  useClubStore,
  useClubRepository,
  defaultClubRepository,
} from "./club.store";
export type { ClubRepository } from "./club.store";
export type { ClubMember } from "./club.store";

export {
  useCompetitionStore,
  useCompetitionRepository,
  defaultCompetitionRepository,
} from "./competition.store";
export type {
  Competition,
  Event,
  ScheduleItem,
  Result,
  CompetitionRegistration,
  PaginatedResponse,
  PaginationMeta,
  ClubPendingRegistration,
  CompetitionRepository,
} from "./competition.store";

export {
  isLibraryStale,
  LIBRARY_MAX_AGE_MS,
  markLibraryStale,
  useLibrarySyncStore,
} from "./librarySync.store";

export { usePerformanceStore } from "./performance.store";
export type {
  Category,
  LoadingProgress,
  Mode,
  PerformanceConfig,
  PlaylistItem,
  RoundConfig,
  RoundType,
} from "./performance.store";

export {
  usePlayerStore,
  PlayerRepeatMode,
  hasExtendedTrackData,
} from "./player.store";
export type { TrackData } from "./player.store";
