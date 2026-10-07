import type { ClubRegistrationMode, UserRole } from '../api/generated/types.gen';

export const ROLE_LABELS: Record<UserRole, string> = {
  LICENSEE: 'Licencié',
  CLUB: 'Club',
  STAFF: 'Staff',
  ADMIN: 'Admin',
};

export const REGISTRATION_MODE_LABELS: Record<ClubRegistrationMode, string> = {
  CLUB_AND_MEMBERS_PENDING: 'Licenciés et club, validation par le club',
  CLUB_ONLY: 'Le club seul inscrit ses licenciés',
  MEMBERS_AUTO_CONFIRM: 'Licenciés, validation automatique',
};
