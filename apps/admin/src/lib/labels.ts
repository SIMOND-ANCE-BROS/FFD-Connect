import type { ClubRegistrationMode, PaymentProvider, UserRole } from '../api/generated/types.gen';

export const ROLE_LABELS: Record<UserRole, string> = {
  LICENSEE: 'Licencié',
  CLUB: 'Club',
  STAFF: 'Staff',
  ADMIN: 'Admin',
};

export const extraRoleLabels = (extraRoles: readonly UserRole[]): string[] =>
  extraRoles.map((r) => `+ ${ROLE_LABELS[r]}`);

export const REGISTRATION_MODE_LABELS: Record<ClubRegistrationMode, string> = {
  CLUB_AND_MEMBERS_PENDING: 'Licenciés et club, validation par le club',
  CLUB_ONLY: 'Le club seul inscrit ses licenciés',
  MEMBERS_AUTO_CONFIRM: 'Licenciés, validation automatique',
};

/** Online payment connectors of a club (#388, #665). */
export const PAYMENT_PROVIDER_LABELS: Record<PaymentProvider, string> = {
  HELLOASSO: 'HelloAsso',
};

/** Label of a connector, or its raw value when this build does not know it. */
export const paymentProviderLabel = (provider: string): string =>
  (PAYMENT_PROVIDER_LABELS as Partial<Record<string, string>>)[provider] ?? provider;

/**
 * Whether the club's connector has its credentials. The list only knows the
 * HelloAsso ones: another connector reads as unknown (null).
 */
export const paymentConfigured = (club: {
  paymentProvider: string;
  helloAssoConfigured: boolean;
}): boolean | null => (club.paymentProvider === 'HELLOASSO' ? club.helloAssoConfigured : null);

export type StatusChoice = 'all' | 'active' | 'disabled';

export const STATUS_FILTER_OPTIONS: { value: StatusChoice; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'active', label: 'Actifs' },
  { value: 'disabled', label: 'Désactivés' },
];
