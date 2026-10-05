/**
 * Types de contrat API pour les Compétitions
 * Source de vérité unique partagée entre le backend et le client.
 */

export type CompetitionStatus = 'UPCOMING' | 'LIVE' | 'PAST' | 'CANCELLED';
export type ScheduleItemType = 'ROUND' | 'BREAK' | 'CEREMONY';
export type RegistrationStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

/** SOLO = inscription seule ; COUPLE = partenaire obligatoire */
export type EventType = 'SOLO' | 'COUPLE';

/** Nature de l'épreuve (Article 9). SOLO_TEAM = Solo Danse Team. */
export type EventKind = 'CLASSIFICATRICE' | 'OPEN' | 'MAJEURE' | 'SOLO_TEAM' | 'SHOW_DANSE';

/** Niveaux Passeport Danse (couleurs). À partir de Vert : évalués séparément en Latine et Standard. */
export type PassportLevel =
  | 'BLANC'
  | 'BEIGE'
  | 'JAUNE'
  | 'ORANGE'
  | 'VERT'
  | 'VIOLET'
  | 'BLEU'
  | 'ROUGE'
  | 'NOIR';

/** Éligibilité à une épreuve (calculée côté serveur pour l'utilisateur connecté). */
export interface ApiEventEligibility {
  eligible: boolean;
  /** Code ou message court (ex. WRONG_CATEGORY, WRONG_AGE_GROUP) pour affichage */
  reason?: string;
}

export interface ApiEvent {
  id: string;
  competitionId: string;
  category: string;
  level?: string;
  ageGroup: string;
  dance?: string;
  /** SOLO ou COUPLE ; défaut COUPLE si absent (rétrocompat) */
  eventType?: EventType;
  /** Nature de l'épreuve (Article 9), dont SOLO_TEAM. Exposé par le backend. */
  eventKind?: EventKind;
  /** Présent lorsque le détail compétition est demandé avec authentification (licencié) */
  eligibility?: ApiEventEligibility;
}

export interface ApiScheduleItem {
  id: string;
  startTime: string;
  title: string;
  type: ScheduleItemType;
  eventId?: string;
}

export interface ApiCompetition {
  id: string;
  ffdId?: string;
  title: string;
  date: string;
  location: string;
  status: CompetitionStatus;
  address?: string;
  zipCode?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  description?: string;
  /** FFD : programme des épreuves (texte libre, peut contenir du HTML). */
  eventsDescription?: string;
  /** FFD : PDF du programme des épreuves. */
  programUrl?: string;
  /** FFD : date de fin (endAt). */
  endDate?: string;
  type?: string;
  organizer?: string;
  organizerEmail?: string;
  circularUrl?: string;
  registrationUrl?: string;
  imageUrl?: string;
  delayMinutes?: number;
  registrationDeadline?: string;
  events?: ApiEvent[];
  schedule?: ApiScheduleItem[];
  /** Calculé côté serveur pour l'utilisateur authentifié */
  isRegistered?: boolean;
  /** Calculé côté serveur pour l'utilisateur authentifié */
  isEligible?: boolean;
  /** Pour les organisateurs : true si la compétition est organisée par le club de l'utilisateur */
  isOrganizedByMyClub?: boolean;
  /** Pour les organisateurs : nombre de membres du club inscrits à cette compétition */
  clubMembersRegisteredCount?: number;
}

export interface ApiRegistration {
  id: string;
  eventId: string;
  userId: string;
  partnerName?: string;
  status: RegistrationStatus;
  bibNumber?: number;
  checkedIn?: boolean;
  checkInTime?: string;
  feePaid?: boolean;
  createdAt: string;
  coupleAgeGroup?: string | null;
  coupleDisciplineLatin?: boolean;
  coupleDisciplineStandard?: boolean;
  event?: ApiEvent;
  competition?: Pick<ApiCompetition, 'id' | 'title' | 'date' | 'location'>;
  user?: {
    id?: string;
    firstName: string;
    lastName: string;
    clubName: string | null;
    nationalRanking: number | null;
  };
}

export interface ApiResult {
  id: string;
  eventId: string;
  round: string;
  ranking: number;
  details: {
    name?: string;
    participant?: string;
    status?: 'QUALIFIED' | 'ELIMINATED';
    marks?: number;
    [key: string]: unknown;
  };
  event?: ApiEvent;
}

/** Réponse paginée générique */
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    skip: number;
    take: number;
    hasMore: boolean;
  };
}
