import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

/** Clé AsyncStorage mémorisant l'id du rappel planifié pour une compétition. */
export function deadlineStorageKey(competitionId: string): string {
  return `deadline_notif_${competitionId}`;
}

/**
 * Valeur sentinelle stockée à la place d'un id de notification : l'utilisateur
 * est inscrit à la compétition, un rappel de deadline n'a plus de sens et ne
 * doit pas être (re)planifié à la prochaine visite de l'écran.
 */
export const REGISTERED_MARKER = "registered";

/**
 * Schedule a local notification 3 days before a competition registration deadline.
 *
 * Returns the notification identifier if scheduled, or null if not (e.g. permission
 * denied, deadline too close, or already past).
 */
export async function scheduleDeadlineNotification(
  competitionId: string,
  competitionTitle: string,
  deadline: string,
): Promise<string | null> {
  try {
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== Notifications.PermissionStatus.GRANTED) {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== Notifications.PermissionStatus.GRANTED) {
      return null;
    }

    const deadlineDate = new Date(deadline);
    const triggerDate = new Date(
      deadlineDate.getTime() - 3 * 24 * 60 * 60 * 1000,
    );

    // Only schedule if 3 days before is still in the future
    if (triggerDate <= new Date()) {
      return null;
    }

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Inscription bientôt fermée",
        body: `L'inscription pour ${competitionTitle} ferme dans 3 jours`,
        data: { competitionId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
      },
    });

    return notificationId;
  } catch {
    return null;
  }
}

/**
 * Cancel a previously scheduled deadline notification.
 */
export async function cancelDeadlineNotification(
  notificationId: string,
): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // Silently ignore — notification may have already fired or been dismissed
  }
}

/**
 * L'utilisateur vient de s'inscrire : annule le rappel de deadline s'il était
 * planifié, puis pose le marqueur "inscrit" pour empêcher toute replanification.
 * Le marqueur est posé même sans rappel planifié (ex. permission accordée plus
 * tard) — inscrit, un rappel n'a plus de sens.
 */
export async function cancelDeadlineNotificationForCompetition(
  competitionId: string,
): Promise<void> {
  try {
    const key = deadlineStorageKey(competitionId);
    const existing = await AsyncStorage.getItem(key);
    if (existing && existing !== REGISTERED_MARKER) {
      await cancelDeadlineNotification(existing);
    }
    await AsyncStorage.setItem(key, REGISTERED_MARKER);
  } catch {
    // Best-effort — un rappel superflu vaut mieux qu'un crash d'inscription
  }
}

/**
 * L'utilisateur vient de se désinscrire : retire le marqueur "inscrit" pour
 * qu'une future visite de l'écran replanifie le rappel. Un vrai id de
 * notification encore stocké est conservé (le rappel reste pertinent).
 */
export async function clearDeadlineMarker(
  competitionId: string,
): Promise<void> {
  try {
    const key = deadlineStorageKey(competitionId);
    const existing = await AsyncStorage.getItem(key);
    if (existing === REGISTERED_MARKER) {
      await AsyncStorage.removeItem(key);
    }
  } catch {
    // Best-effort
  }
}

/**
 * Deadline passée (ou trop proche pour un rappel) : purge la clé devenue
 * obsolète — le rappel a déjà sonné ou ne sonnera jamais.
 */
export async function clearDeadlineStorage(
  competitionId: string,
): Promise<void> {
  try {
    await AsyncStorage.removeItem(deadlineStorageKey(competitionId));
  } catch {
    // Best-effort
  }
}
