export type EditorTab = "GENERAL" | "EVENTS" | "TIMING" | "ORGANISATION";
export type CompetitionStatus =
  | "DRAFT"
  | "OPEN"
  | "CLOSED"
  | "UPCOMING"
  | "LIVE"
  | "PAST"
  | "CANCELLED";

/**
 * Type guard pour valider CompetitionStatus
 */
export function isValidCompetitionStatus(
  value: string,
): value is CompetitionStatus {
  return [
    "DRAFT",
    "OPEN",
    "CLOSED",
    "UPCOMING",
    "LIVE",
    "PAST",
    "CANCELLED",
  ].includes(value);
}

/**
 * Convertit une string en CompetitionStatus de manière sécurisée
 */
export function toCompetitionStatus(value: string): CompetitionStatus {
  if (isValidCompetitionStatus(value)) {
    return value;
  }
  return "DRAFT"; // Valeur par défaut
}

export type CompetitionType =
  | "PROXIMITE"
  | "NATIONALE"
  | "MAJEURE"
  | "INTERNATIONALE";

/**
 * Distingue une compétition (avec épreuves, planning, type de compétition)
 * d'un événement non compétitif (gala / stage / soirée : infos + programme libre).
 * Stocké dans le champ Prisma `type` ("COMPETITION" | "EVENT").
 */
export type CompetitionKind = "COMPETITION" | "EVENT";

export type EventKind =
  | "CLASSIFICATRICE"
  | "OPEN"
  | "MAJEURE"
  | "SOLO_TEAM"
  | "SHOW_DANSE";

/** Niveaux possibles pour épreuves classificatrices (toutes compétitions). */
export const COMPETITION_LEVELS = [
  "International",
  "Avancé",
  "Intermédiaire",
  "Débutant",
] as const;

/** En proximité, les classificatrices ne peuvent être que Débutant ou Intermédiaire. */
export const LEVELS_FOR_PROXIMITE_CLASSIFICATRICE = [
  "Débutant",
  "Intermédiaire",
] as const;

/** Types d'épreuves autorisés par type de compétition (aligné backend). */
export const ALLOWED_EVENT_KINDS_BY_COMPETITION_TYPE: Record<
  CompetitionType,
  readonly EventKind[]
> = {
  PROXIMITE: ["CLASSIFICATRICE", "OPEN", "SOLO_TEAM", "SHOW_DANSE"],
  NATIONALE: ["CLASSIFICATRICE", "OPEN", "MAJEURE", "SOLO_TEAM", "SHOW_DANSE"],
  MAJEURE: ["CLASSIFICATRICE", "OPEN", "MAJEURE", "SOLO_TEAM", "SHOW_DANSE"],
  INTERNATIONALE: [
    "CLASSIFICATRICE",
    "OPEN",
    "MAJEURE",
    "SOLO_TEAM",
    "SHOW_DANSE",
  ],
};

/** Libellés type de compétition. */
export const COMPETITION_TYPE_LABELS: Record<CompetitionType, string> = {
  PROXIMITE: "Proximité",
  NATIONALE: "Nationale",
  MAJEURE: "Majeure",
  INTERNATIONALE: "Internationale",
};

/** Sous-type obligatoire lorsque la compétition est de type MAJEURE. */
export type MajorSubType =
  | "CHAMPIONNAT_REGIONAL"
  | "CHAMPIONNAT_FRANCE_LATINES"
  | "CHAMPIONNAT_FRANCE_STANDARDS"
  | "CHAMPIONNAT_FRANCE_10_DANSES"
  | "CHAMPIONNAT_FRANCE_SHOW_DANSE"
  | "CHAMPIONNAT_FRANCE_SOLO_TEAM"
  | "CRITERIUMS_NATIONAUX";

export const MAJOR_SUB_TYPES: readonly MajorSubType[] = [
  "CHAMPIONNAT_REGIONAL",
  "CHAMPIONNAT_FRANCE_LATINES",
  "CHAMPIONNAT_FRANCE_STANDARDS",
  "CHAMPIONNAT_FRANCE_10_DANSES",
  "CHAMPIONNAT_FRANCE_SHOW_DANSE",
  "CHAMPIONNAT_FRANCE_SOLO_TEAM",
  "CRITERIUMS_NATIONAUX",
];

export const MAJOR_SUB_TYPE_LABELS: Record<MajorSubType, string> = {
  CHAMPIONNAT_REGIONAL: "Championnats régionaux",
  CHAMPIONNAT_FRANCE_LATINES: "Championnats de France Latines",
  CHAMPIONNAT_FRANCE_STANDARDS: "Championnats de France Standards",
  CHAMPIONNAT_FRANCE_10_DANSES: "Championnats de France 10 danses",
  CHAMPIONNAT_FRANCE_SHOW_DANSE: "Championnat de France de Show danse",
  CHAMPIONNAT_FRANCE_SOLO_TEAM: "Championnat de France de Solo Danse Team",
  CRITERIUMS_NATIONAUX: "Critériums nationaux",
};

/** Catégories d'âge pour les équipes Solo Team (moyenne d'âge au 31/12). */
export const SOLO_TEAM_AGE_GROUPS = [
  "Juvénile", // < 12 ans
  "Junior", // < 16 ans
  "Adulte", // < 30 ans
  "Senior", // 30 ans et +
] as const;

/** Niveaux pour Solo Team (Débutant ou Intermédiaire). */
export const SOLO_TEAM_LEVELS = ["Débutant", "Intermédiaire"] as const;

/** Libellés type d'épreuve. */
export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  CLASSIFICATRICE: "Classificatrice",
  OPEN: "Open",
  MAJEURE: "Majeure",
  SOLO_TEAM: "Solo Team",
  SHOW_DANSE: "Show danse",
};

export interface EventItem {
  id: string;
  type: "Couple" | "Solo";
  category: string;
  ageGroup: string;
  /** Pour Open : plusieurs catégories d'âge autorisées. */
  ageGroups?: string[];
  /** Pour Open : restriction par niveaux (vide = tous niveaux). */
  openLevels?: string[];
  kind?: EventKind;
  /** Niveau pour épreuve classificatrice ou Solo Team. */
  level?: string;
  /** Déjà enregistrée : `id` est celui du serveur (#442). */
  persisted?: boolean;
  /** Inscriptions ou résultats : ni modifiable ni supprimable (#442). */
  locked?: boolean;
}

export interface ScheduleItem {
  id: string;
  startTime: string; // HH:MM
  type: "ROUND" | "BREAK" | "CEREMONY" | "OTHER";
  title: string;
  duration: number; // minutes
  /** Déjà enregistré : `id` est celui du serveur (#442). */
  persisted?: boolean;
}

export type LayoutOrientation = "horizontal" | "vertical";

export interface LayoutItem {
  id: string;
  type: "TABLE" | "GRADIN" | "OTHER";
  label: string;
  capacity: number;
  x: number; // Percent 0-100
  y: number; // Percent 0-100
  width: number;
  height: number;
  rows?: number;
  cols?: number;
  /** Indices of seats that are "non disponible" (locked / not bookable) */
  lockedSeats?: number[];
  /** Orientation du bloc : horizontal (large) ou vertical (haut) */
  orientation?: LayoutOrientation;
  /** Rotation supplémentaire en degrés (optionnel, purement visuel) */
  rotationDeg?: number;
  /** Seat price in cents (#405); absent → not payable online. */
  priceCents?: number;
}

export interface Competition {
  id: string;
  title: string;
  status: CompetitionStatus;
  date: string;
  location: string;
  competitionType?: CompetitionType;
  /** Requis si competitionType === 'MAJEURE'. */
  majorSubType?: MajorSubType;
  /** "COMPETITION" (défaut) ou "EVENT" (événement non compétitif). */
  type?: string;
  /** Texte libre — programme (pour un événement) / programme des épreuves. */
  eventsDescription?: string;
  events: EventItem[];
  schedule: ScheduleItem[];
  ticketingUrl?: string;
  layout?: LayoutItem[];
}

// "LES COUPLES" (Article 5)
export const AGES_COUPLE = [
  "Juvénile I",
  "Juvénile II",
  "Junior I",
  "Junior II",
  "Youth",
  // Épreuve couple « moins de 21 ans » (16-20 ans au 31/12) : classe d'épreuve,
  // vérifiée à l'inscription.
  "Espoir",
  "Adulte",
  "Senior I",
  "Senior II",
  "Senior III",
  "Senior IV",
  "Senior V",
];

// "LES SOLOS" (Article 5) — valeurs enregistrées telles quelles (#442).
export const AGES_SOLO = [
  "Solo Juvénile",
  "Solo Junior 1",
  "Solo Junior 2",
  "Solo Youth",
  "Solo Adulte",
  "Solo Senior",
];

/**
 * Niveaux possibles d'une classificatrice selon la classe d'âge (table
 * Niveaux du règlement, alignée sur le backend `getAllowedLevelsForAgeGroup`).
 */
const LEVELS_BY_AGE_GROUP: Record<string, readonly string[]> = {
  "Juvénile I": ["Intermédiaire", "Débutant"],
  "Juvénile II": ["Intermédiaire", "Débutant"],
  "Junior I": ["Avancé", "Intermédiaire", "Débutant"],
  "Junior II": ["Avancé", "Intermédiaire", "Débutant"],
  Youth: ["Avancé", "Intermédiaire", "Débutant"],
  Espoir: ["International", "Avancé", "Intermédiaire"],
  Adulte: ["International", "Avancé", "Intermédiaire"],
  "Senior I": ["International", "Avancé", "Intermédiaire"],
  "Senior II": ["International", "Avancé", "Intermédiaire"],
  "Senior III": ["International", "Avancé", "Intermédiaire", "Débutant"],
  "Senior IV": ["International", "Avancé", "Intermédiaire"],
  "Senior V": ["International", "Avancé", "Intermédiaire"],
  "Solo Juvénile": ["Intermédiaire", "Débutant"],
  "Solo Junior 1": ["Avancé", "Intermédiaire", "Débutant"],
  "Solo Junior 2": ["Avancé", "Intermédiaire", "Débutant"],
  "Solo Youth": ["Avancé", "Intermédiaire", "Débutant"],
  "Solo Adulte": ["Avancé", "Intermédiaire", "Débutant"],
  "Solo Senior": ["Avancé", "Intermédiaire", "Débutant"],
};

export function levelsForAgeGroup(ageGroup: string): readonly string[] {
  return LEVELS_BY_AGE_GROUP[ageGroup] ?? [];
}

/** Canonical value of the « 10 danses » discipline (#639), as stored by the API. */
export const TEN_DANCE_CATEGORY = "Ten Dance";

/**
 * Disciplines the club can pick for an event of this kind. « 10 danses » is
 * a majeure-only event without level (backend `program-rules.ts`, #442).
 */
export function categoryOptionsForKind(kind: EventKind): readonly string[] {
  return kind === "MAJEURE"
    ? ["Latine", "Standard", TEN_DANCE_CATEGORY]
    : ["Latine", "Standard"];
}

/**
 * Couple age classes of a discipline: no « Senior V » in Latin (those couples
 * dance Senior IV); Standard and 10 danses keep it (backend
 * `ageGroupsForEvent`).
 */
export function coupleAgesForCategory(category: string): string[] {
  return category === "Latine"
    ? AGES_COUPLE.filter((age) => age !== "Senior V")
    : [...AGES_COUPLE];
}
