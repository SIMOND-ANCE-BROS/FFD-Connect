import { formatSpokenDuration, joinA11yLabel } from "../../../utils/a11y";

/**
 * Screen-reader wording of the competition-mode player (#22). The visual
 * shows an all-caps phase badge and a ticking « 1:05 » clock: the reader
 * gets one sentence instead, read on focus — never announced on each tick.
 */

export type PerformancePhase = "preparation" | "break" | "dance";

const PHASE_NAMES: Record<PerformancePhase, string> = {
  preparation: "Préparation",
  break: "Pause",
  dance: "En cours",
};

/** « Tour 1 sur 3 » instead of « TOUR 1/3 » (a slash reads as « barre »). */
export function roundChipA11yLabel(
  roundIndex: number,
  totalRounds: number,
): string {
  return `Tour ${roundIndex} sur ${totalRounds}`;
}

/** The phase block as one sentence: phase, dance, time left, what's next. */
export function phaseA11yLabel({
  phase,
  danceName,
  timeRemaining,
  detail,
}: {
  phase: PerformancePhase;
  /** Dance being played (dance phase only). */
  danceName?: string | null;
  timeRemaining: number;
  /** Caption under the clock (« Suivant : … », « Annonce en cours… »). */
  detail?: string | null;
}): string {
  return joinA11yLabel([
    PHASE_NAMES[phase],
    phase === "dance" ? danceName : null,
    `il reste ${formatSpokenDuration(timeRemaining)}`,
    detail,
  ]);
}

/**
 * What the reader says when the phase changes (a new dance starts, a pause
 * begins). No clock: it is stale a second later.
 */
export function phaseChangeAnnouncement({
  phase,
  danceName,
  detail,
}: {
  phase: PerformancePhase;
  danceName?: string | null;
  detail?: string | null;
}): string {
  return joinA11yLabel([
    PHASE_NAMES[phase],
    phase === "dance" ? danceName : null,
    phase === "dance" ? null : detail,
  ]);
}
