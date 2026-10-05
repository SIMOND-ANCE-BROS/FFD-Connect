// Barrel export — single entry point for all stores.
// Components import from 'stores/', never from 'stores/auth.store' directly.

export { useAuthStore } from "./auth.store";

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

export { usePerformanceStore } from "./performance.store";
export type {
  Category,
  Mode,
  PerformanceConfig,
  PlaylistItem,
} from "./performance.store";

export {
  usePlayerStore,
  PlayerRepeatMode,
  hasExtendedTrackData,
} from "./player.store";
export type { TrackData } from "./player.store";
