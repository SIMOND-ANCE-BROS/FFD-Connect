/**
 * BackendService — backward-compatible facade.
 *
 * All methods are implemented in domain-specific modules under ./api/.
 * New code should import directly from the domain module:
 *   import { TrackApi } from "../services/api/track-api";
 *
 * This file re-exports everything so existing imports keep working.
 */

import { CareerApi } from "./api/career-api";
import { HealthApi } from "./api/health-api";
import { LicenseApi } from "./api/license-api";
import { NotificationApi } from "./api/notification-api";
import { TrackApi } from "./api/track-api";

// Re-export all types for backward compatibility
export type {
  CareerPartnership,
  CareerRegistration,
  CareerResponse,
  CareerResult,
  CareerSearchMember,
} from "./api/career-api";
export type {
  LicenseRenewalDocument,
  LicenseRenewalDocumentType,
  LicenseRenewalRequest,
  LicenseRenewalStatus,
} from "./api/license-api";

// Arrow-function wrappers to avoid unbound-method ESLint errors
export const BackendService = {
  // Track
  getTrack: (...args: Parameters<typeof TrackApi.getTrack>) =>
    TrackApi.getTrack(...args),
  updateTrack: (...args: Parameters<typeof TrackApi.updateTrack>) =>
    TrackApi.updateTrack(...args),
  deleteTrack: (...args: Parameters<typeof TrackApi.deleteTrack>) =>
    TrackApi.deleteTrack(...args),

  // Health
  checkHealth: () => HealthApi.checkHealth(),

  // License
  getMyLicense: <T = unknown>(
    ...args: Parameters<typeof LicenseApi.getMyLicense<T>>
  ) => LicenseApi.getMyLicense<T>(...args),
  startRenewalRequest: (
    ...args: Parameters<typeof LicenseApi.startRenewalRequest>
  ) => LicenseApi.startRenewalRequest(...args),
  getMyRenewalRequest: (
    ...args: Parameters<typeof LicenseApi.getMyRenewalRequest>
  ) => LicenseApi.getMyRenewalRequest(...args),
  uploadRenewalDocument: (
    ...args: Parameters<typeof LicenseApi.uploadRenewalDocument>
  ) => LicenseApi.uploadRenewalDocument(...args),
  submitRenewalRequest: (
    ...args: Parameters<typeof LicenseApi.submitRenewalRequest>
  ) => LicenseApi.submitRenewalRequest(...args),
  renewLicense: (...args: Parameters<typeof LicenseApi.renewLicense>) =>
    LicenseApi.renewLicense(...args),

  // Career
  getMyCareer: (...args: Parameters<typeof CareerApi.getMyCareer>) =>
    CareerApi.getMyCareer(...args),
  getUserCareer: (...args: Parameters<typeof CareerApi.getUserCareer>) =>
    CareerApi.getUserCareer(...args),
  searchCareerMembers: (
    ...args: Parameters<typeof CareerApi.searchCareerMembers>
  ) => CareerApi.searchCareerMembers(...args),

  // Notifications
  getNotifications: <T = unknown>(
    ...args: Parameters<typeof NotificationApi.getNotifications<T>>
  ) => NotificationApi.getNotifications<T>(...args),
  markNotificationAsRead: (
    ...args: Parameters<typeof NotificationApi.markNotificationAsRead>
  ) => NotificationApi.markNotificationAsRead(...args),
  markAllNotificationsAsRead: (
    ...args: Parameters<typeof NotificationApi.markAllNotificationsAsRead>
  ) => NotificationApi.markAllNotificationsAsRead(...args),
};
