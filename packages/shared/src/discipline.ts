/**
 * Capacités d'un domaine de danse (ADR-0026, #1022).
 *
 * Une capacité est une fonctionnalité qu'un domaine utilise (couples,
 * Passeport Danse, niveaux de compétition…). La liste est FERMÉE : une
 * nouvelle capacité veut dire du nouveau code. En base, les capacités sont
 * stockées en texte (`DanceDomain.capabilities`) ; toute valeur absente de
 * cette liste est ignorée à la lecture.
 *
 * Le code teste une capacité, jamais un code de discipline.
 */
export const DANCE_CAPABILITIES = [
  /** Partenariats, couples, inscription en couple. */
  'COUPLE',
  /** Équipes et formations (SoloTeam). */
  'TEAM',
  /** Passeport Danse (couleurs) et règles d'accès aux niveaux. */
  'PASSPORT',
  /** Niveaux de compétition par discipline (Débutant → International). */
  'COMPETITION_LEVELS',
  /** Lecteur au tempo réglementaire (MPM). */
  'TEMPO_PLAYER',
  /** Épreuves en rounds jugées au Skating System, import TopTurnier, WDSF. */
  'COMPETITION_SKATING',
] as const;

export type DanceCapability = (typeof DANCE_CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set(DANCE_CAPABILITIES);

/** True when the value is a capability known to this version of the code. */
export function isDanceCapability(value: unknown): value is DanceCapability {
  return typeof value === 'string' && CAPABILITY_SET.has(value);
}
