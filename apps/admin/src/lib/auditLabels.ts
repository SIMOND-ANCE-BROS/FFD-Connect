import type { AuditLogEntryDto } from '../api/generated/types.gen';

export const ACTION_LABELS: Record<AuditLogEntryDto['action'], string> = {
  USER_UPDATE: 'Modification de fiche',
  CLUB_ACCOUNT_CREATE: 'Création de compte Club',
  INVITATION_RESEND: "Renvoi d'invitation",
  USER_CREATE: "Création d'utilisateur",
  USER_DISABLE: "Désactivation d'utilisateur",
  USER_ENABLE: "Réactivation d'utilisateur",
  USER_DELETE: "Suppression d'utilisateur",
  CLUB_UPDATE: 'Modification de club',
  CLUB_DISABLE: 'Désactivation de club',
  CLUB_ENABLE: 'Réactivation de club',
  CLUB_DELETE: 'Suppression de club',
};
