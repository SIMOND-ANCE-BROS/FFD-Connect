/**
 * Types utilitaires réutilisables pour FFD Connect
 */

/** Type pour représenter un ID unique (UUID) */
export type ID = string;

export type { ApiErrorResponse } from './api-error';

export type {
  ApiCompetition,
  ApiEvent,
  ApiRegistration,
  ApiResult,
  ApiScheduleItem,
  CompetitionStatus,
  PaginatedResponse,
  RegistrationStatus,
  ScheduleItemType,
} from './competition';

export type {
  BookingStatus,
  CompetitionType,
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
  PartnershipStatus,
  UserRole,
} from './user';
