import type { AuditLogEntryDto } from '../api/generated/types.gen';

export const ACTION_LABELS: Record<AuditLogEntryDto['action'], string> = {
  USER_UPDATE: 'Modification de fiche',
  CLUB_ACCOUNT_CREATE: 'Création de compte Club',
  INVITATION_RESEND: "Renvoi d'invitation",
};
