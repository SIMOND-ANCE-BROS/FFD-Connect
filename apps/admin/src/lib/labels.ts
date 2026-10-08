import type { ClubRegistrationMode, UserRole } from '../api/generated/types.gen';

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

export type StatusChoice = 'all' | 'active' | 'disabled';

export const STATUS_FILTER_OPTIONS: { value: StatusChoice; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'active', label: 'Actifs' },
  { value: 'disabled', label: 'Désactivés' },
];
