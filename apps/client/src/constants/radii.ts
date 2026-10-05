/**
 * Échelle de rayons de bordure partagée pour homogénéiser l'app. Les valeurs
 * reprennent les plus fréquentes déjà en place (8/12/16). À utiliser pour toute
 * nouvelle surface ; migration des anciennes valeurs au fil de l'eau.
 *
 * - sm    : petites puces / badges
 * - md    : champs, boutons, petites cartes (défaut)
 * - lg    : cartes, modales secondaires
 * - xl    : grandes feuilles / sheets
 * - pill  : capsules (boutons ronds, onglets) — height/2 sinon
 */
export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export type RadiusToken = keyof typeof radii;
