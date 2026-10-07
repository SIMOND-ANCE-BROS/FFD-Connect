import type { RootStackParamList } from "../../../navigation/types";

/**
 * Destination d'une notification « proposition de correction ».
 *
 * Même forme `{ screen, params }` que les autres destinations de notification,
 * pour pouvoir être branchée telle quelle dans le routage commun des taps.
 */
export type TrackCorrectionNotificationTarget =
  | {
      readonly screen: "TrackCorrectionsReview";
      readonly params: RootStackParamList["TrackCorrectionsReview"];
    }
  | {
      readonly screen: "MyTrackCorrections";
      readonly params: RootStackParamList["MyTrackCorrections"];
    };

const field = (data: unknown, key: string): string | null => {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(data, key)) return null;
  const raw = (data as Record<string, unknown>)[key];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
};

/**
 * - `TRACK_CORRECTION` (reçue par les admins) → file de modération, centrée
 *   sur la proposition concernée ;
 * - `TRACK_CORRECTION_DECISION` (reçue par l'auteur) → « Mes propositions ».
 *
 * Tout le reste → `null` : la charge utile est de forme libre côté serveur et
 * un type inconnu ne doit jamais faire planter un client plus ancien.
 */
export function trackCorrectionTargetOf(
  data: unknown,
): TrackCorrectionNotificationTarget | null {
  const type = field(data, "type");
  if (type === "TRACK_CORRECTION") {
    const correctionId = field(data, "correctionId");
    return {
      screen: "TrackCorrectionsReview",
      params: correctionId ? { correctionId } : undefined,
    };
  }
  if (type === "TRACK_CORRECTION_DECISION") {
    return { screen: "MyTrackCorrections", params: undefined };
  }
  return null;
}
