/**
 * Types de domaine utilisateur partagés entre backend et client.
 * Miroir des enums Prisma — source de vérité : schema.prisma.
 */

export type UserRole = 'LICENSEE' | 'CLUB' | 'STAFF' | 'ADMIN';

export type LicenseRenewalStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';

export type LicenseRenewalDocumentType = 'MEDICAL_CERTIFICATE' | 'LICENSE_CERTIFICATE';

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';

export type PartnershipStatus = 'PENDING_SECOND_CLUB' | 'ACTIVE' | 'REJECTED';

export type CompetitionType = 'PROXIMITE' | 'NATIONALE' | 'MAJEURE' | 'INTERNATIONALE';
