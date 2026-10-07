import { RootStackParamList } from "../../../navigation/types";

/**
 * Destination d'une notification, déduite de sa charge utile.
 *
 * UN SEUL endroit lit la charge utile, pour deux points d'entrée : le tap sur
 * une carte du centre de notifications, et le tap sur la push système. Sans ça,
 * les deux chemins divergeraient — on l'a déjà vu, le second ne menait
 * nulle part pendant que le premier fonctionnait.
 *
 * `data` est un `Json?` rempli par le producteur côté serveur : de forme libre,
 * potentiellement inconnue d'un client plus ancien. Ce qu'on ne reconnaît pas
 * renvoie `null`, et c'est à l'appelant de décider ce qu'il en fait.
 */
export type NotificationTarget = {
  readonly [K in keyof RootStackParamList]: {
    readonly screen: K;
    readonly params: RootStackParamList[K];
  };
}[keyof RootStackParamList];

/** Lit une chaîne non vide dans une charge utile de forme inconnue. */
const stringField = (data: unknown, key: string): string | null => {
  if (typeof data !== "object" || data === null) return null;
  const raw = (data as Record<string, unknown>)[key];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
};

/**
 * Destination reconnue, ou `null` si la charge utile n'en désigne aucune.
 *
 * `null` n'est pas un échec : une notification de test, un signalement de
 * musique ou un partenariat ne pointent vers aucun écran — il n'y a rien à
 * ouvrir. Les deux appelants en tirent des conclusions différentes, à dessein :
 * l'écran ne bouge pas, la push ouvre le centre de notifications.
 */
export function notificationTargetOf(data: unknown): NotificationTarget | null {
  const competitionId = stringField(data, "competitionId");
  if (competitionId) {
    return { screen: "CompetitionDetail", params: { competitionId } };
  }
  return null;
}
