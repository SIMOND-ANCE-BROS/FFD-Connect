/**
 * Package shared pour FFD Connect
 *
 * Types et utilitaires partagés entre le backend et le client (Expo/React Native).
 */

export type { ID, ApiErrorResponse } from './types';
export type {
  ApiCompetition,
  ApiEvent,
  ApiRegistration,
  ApiResult,
  ApiScheduleItem,
  CompetitionEventsSource,
  CompetitionStatus,
  EventType,
  PaginatedResponse,
  PassportLevel,
  RegistrationStatus,
  ScheduleItemType,
} from './types/competition';
export type {
  BookingStatus,
  CompetitionType,
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
  PartnershipStatus,
  UserRole,
} from './types/user';
