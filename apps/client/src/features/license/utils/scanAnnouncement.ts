import { joinA11yLabel, toSpokenCase } from "../../../utils/a11y";
import { formatDiscipline } from "../../../utils/discipline";
import type { CheckinResponse } from "../services/CheckinService";

/**
 * Screen-reader wording of a scan result (#22). The scanner shows its verdict
 * as a coloured card over the camera: a staff member using VoiceOver /
 * TalkBack must hear it without hunting for the card.
 */

export type CheckinOutcome = "SUCCESS" | "DENIED" | "NEUTRAL" | "ERROR";

/** Overall verdict of an online check-in (drives the title and colour). */
export function checkinOutcome(
  result: CheckinResponse | null,
  error: string | null,
): CheckinOutcome {
  if (error) return "ERROR";
  if (!result) return "NEUTRAL";
  const successes = result.registrations.filter(
    (r) => r.status === "SUCCESS" || r.status === "ALREADY_CHECKED_IN",
  ).length;
  const failures = result.registrations.filter(
    (r) => r.status === "ERROR",
  ).length;
  if (failures > 0 && successes === 0) return "DENIED";
  if (successes > 0) return "SUCCESS";
  return "NEUTRAL";
}

export const CHECKIN_TITLES: Record<CheckinOutcome, string> = {
  SUCCESS: "CHECK-IN RÉUSSI",
  DENIED: "ACCÈS REFUSÉ",
  NEUTRAL: "RÉSULTAT DU SCAN",
  ERROR: "ERREUR",
};

type Registration = CheckinResponse["registrations"][number];

function spokenStatus(reg: Registration): string {
  switch (reg.status) {
    case "SUCCESS":
      return "validé";
    case "ALREADY_CHECKED_IN":
      return "déjà enregistré";
    case "ERROR":
      return reg.message ?? "erreur";
  }
}

/** One registration as one sentence: « Latin, dossard 12, validé, partenaire Léa ». */
export function registrationA11yLabel(reg: Registration): string {
  return joinA11yLabel([
    formatDiscipline(reg.event),
    reg.bibNumber != null ? `dossard ${reg.bibNumber}` : "sans dossard",
    spokenStatus(reg),
    reg.partner ? `partenaire ${reg.partner}` : null,
  ]);
}

/** What the reader says when an online scan result (or error) appears. */
export function checkinAnnouncement(
  result: CheckinResponse | null,
  error: string | null,
): string | null {
  if (error) return joinA11yLabel(["Erreur", error]);
  if (!result) return null;
  const title = toSpokenCase(CHECKIN_TITLES[checkinOutcome(result, error)]);
  return joinA11yLabel([
    title,
    `${result.user.firstName} ${result.user.lastName}`,
    result.qrVerification?.warning ?? null,
    ...result.registrations.map(registrationA11yLabel),
  ]);
}

/** What the reader says when an offline verdict appears. */
export function offlineCheckinAnnouncement(
  title: string,
  message: string,
  holderName?: string,
): string {
  // "QR PÉRIMÉ" → "QR périmé" (not "Qr", which some voices read as a word).
  const spokenTitle = toSpokenCase(title).replace(/\bqr\b/gi, "QR");
  return joinA11yLabel([spokenTitle, holderName, message]);
}
