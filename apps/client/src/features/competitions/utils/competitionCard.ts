/**
 * Helpers purs pour les cartes de compétition (#297).
 * Extraits de CompetitionsScreen pour être testables.
 */

const PARIS_TZ = "Europe/Paris";

/** Index de jour calendaire (heure de Paris) pour un diff en jours entiers. */
function parisDayIndex(d: Date): number {
  // 'en-CA' → "YYYY-MM-DD" ; on le réinterprète en UTC minuit pour l'index.
  const ymd = d.toLocaleDateString("en-CA", { timeZone: PARIS_TZ });
  return Math.floor(new Date(`${ymd}T00:00:00Z`).getTime() / 86_400_000);
}

/**
 * Jours calendaires (Paris) avant la deadline d'inscription, si elle est dans
 * ≤14 jours. `0` = deadline aujourd'hui ("dernier jour"). Renvoie `null` si pas
 * de deadline, date invalide, jour déjà passé, ou > 14 jours.
 * @param now injectable pour les tests.
 */
export function getDeadlineDays(
  deadline: string | undefined | null,
  now: Date = new Date(),
): number | null {
  if (!deadline) return null;
  const dl = new Date(deadline);
  if (Number.isNaN(dl.getTime())) return null;
  const days = parisDayIndex(dl) - parisDayIndex(now);
  if (days < 0 || days > 14) return null;
  return days;
}

/** Texte du compte à rebours (couleur gérée par l'appelant). */
export function deadlineLabel(days: number): string {
  return days === 0
    ? "Inscriptions : dernier jour !"
    : `Inscriptions : J-${days}`;
}

/** Fuseau du device (ou `PARIS_TZ` si indétectable → on n'affiche pas le label à tort). */
export function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || PARIS_TZ;
  } catch {
    return PARIS_TZ;
  }
}

/** true si le device n'est PAS à l'heure de Paris → afficher le label "heure de Paris". */
export function shouldShowParisLabel(
  deviceTz: string = getDeviceTimeZone(),
): boolean {
  return deviceTz !== PARIS_TZ;
}

/** Heure "HH:mm" TOUJOURS en heure de Paris (peu importe le fuseau du device). */
export function formatParisTime(dateIso: string): string {
  return new Date(dateIso).toLocaleTimeString("fr-FR", {
    timeZone: PARIS_TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Date longue en heure de Paris (évite le décalage de jour à l'étranger). */
export function formatParisDate(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString("fr-FR", {
    timeZone: PARIS_TZ,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Statut effectif d'une compétition, dérivé de sa DATE et non du `status`
 * stocké — qui peut être périmé (le backend laisse parfois un événement déjà
 * passé en `UPCOMING`). Source unique de vérité partagée par le filtre d'onglet
 * et le badge de la carte, pour qu'ils ne divergent jamais (#bug filtre/badge :
 * un `UPCOMING` daté dans le passé disparaissait de « À venir » ET de « Passées »,
 * tout en s'affichant « À VENIR » dans « Tout »).
 *
 * Règles :
 *  - `LIVE` explicite du backend → conservé (signal « en cours » fiable, une
 *    compétition multi-jours peut avoir une date de début < aujourd'hui).
 *  - date valide < aujourd'hui 00:00 → `PAST` (quel que soit le statut stocké).
 *  - sinon → `UPCOMING`.
 *  - date absente/invalide → on retombe sur le statut stocké (dégradation).
 *
 * @param now injectable pour les tests.
 */
export function getEffectiveCompetitionStatus(
  status: string,
  date: string | null | undefined,
  now: Date = new Date(),
): string {
  if (status === "LIVE") return "LIVE";
  if (!date) return status;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return status;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  return t < startOfToday.getTime() ? "PAST" : "UPCOMING";
}
