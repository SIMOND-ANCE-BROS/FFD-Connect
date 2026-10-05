import { theme } from "../theme";

/**
 * Palmarès podium styling — visual distinction for the top-3 rankings.
 *
 * Acceptance criterion #136: the top 3 must be distinguishable (gold / silver /
 * bronze). The rank number itself always stays visible in the badge, so the
 * information is never conveyed by colour alone (WCAG 1.4.1) — this helper only
 * resolves the colours.
 */

export type PodiumRank = 1 | 2 | 3;

export interface PodiumStyle {
  /** True for ranks 1-3. */
  isPodium: boolean;
  /** Badge fill colour. */
  backgroundColor: string;
  /**
   * Rank-number colour. Podium uses dark ink (slate900) for AA contrast on the
   * light metallic fills; off-podium keeps the historical white-on-primary.
   */
  textColor: string;
}

const MEDAL_COLORS: Record<PodiumRank, string> = {
  1: theme.colors.gold,
  2: theme.colors.silver,
  3: theme.colors.bronze,
};

/** True when `rank` is a podium position (1, 2 or 3). */
export function isPodiumRank(rank: number): rank is PodiumRank {
  return Number.isInteger(rank) && rank >= 1 && rank <= 3;
}

/**
 * Resolve the ranking-badge style for a given rank.
 *
 * @param rank    1-based competition ranking.
 * @param primary Theme primary colour, used as the off-podium badge fill
 *                (preserves the pre-existing look for ranks 4+).
 */
export function getPodiumStyle(rank: number, primary: string): PodiumStyle {
  if (isPodiumRank(rank)) {
    return {
      isPodium: true,
      backgroundColor: MEDAL_COLORS[rank],
      textColor: theme.colors.slate900,
    };
  }
  return {
    isPodium: false,
    backgroundColor: primary,
    textColor: theme.colors.white,
  };
}
