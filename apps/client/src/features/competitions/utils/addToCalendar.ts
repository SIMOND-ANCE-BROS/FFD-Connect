// expo-calendar 57 moved the classic *Async API (requestCalendarPermissionsAsync,
// getCalendarsAsync, createEventAsync, EntityTypes) to the /legacy entry point;
// the root export is now a new class-based API. PermissionStatus is no longer
// re-exported by expo-calendar and must come from `expo`.
import * as Calendar from "expo-calendar/legacy";
import { PermissionStatus } from "expo";
import { Alert, Platform } from "react-native";

/** Champs de la compétition nécessaires à la création d'événement calendrier. */
export interface CalendarCompetitionDetails {
  title: string;
  date: string;
  address?: string | null;
  zipCode?: string | null;
  city?: string | null;
  location?: string;
  description?: string | null;
}

/** Durée par défaut de l'événement quand la compétition n'a pas d'heure de fin. */
const DEFAULT_DURATION_MS = 8 * 60 * 60 * 1000;

/**
 * Ajoute la compétition au calendrier de l'utilisateur (#298).
 *
 * Gère permission, choix du calendrier par défaut (modifiable), création de
 * l'événement (+8h par défaut) et le feedback utilisateur via Alert.
 * Extrait de CompetitionDetailScreen pour être testable unitairement.
 */
export async function addCompetitionToCalendar(
  details: CalendarCompetitionDetails,
): Promise<void> {
  try {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== PermissionStatus.GRANTED) {
      Alert.alert(
        "Permission requise",
        "L'accès au calendrier est nécessaire pour ajouter cet événement.",
      );
      return;
    }

    const calendars = await Calendar.getCalendarsAsync(
      Calendar.EntityTypes.EVENT,
    );
    const defaultCalendar =
      calendars.find(
        (cal) =>
          cal.allowsModifications &&
          (Platform.OS === "ios"
            ? cal.source.name === "Default"
            : cal.isPrimary),
      ) ?? calendars.find((cal) => cal.allowsModifications);

    if (!defaultCalendar) {
      Alert.alert("Erreur", "Aucun calendrier disponible.");
      return;
    }

    const startDate = new Date(details.date);
    const endDate = new Date(startDate.getTime() + DEFAULT_DURATION_MS);

    // Anti-doublon : si un événement de même titre existe déjà autour de la même
    // heure dans ce calendrier, on ne recrée pas (sinon chaque tap empile un
    // doublon). On fenêtre la recherche autour de l'heure de début.
    const existingEvents = await Calendar.getEventsAsync(
      [defaultCalendar.id],
      new Date(startDate.getTime() - 60 * 1000),
      endDate,
    );
    const alreadyAdded = existingEvents.some(
      (event) =>
        event.title === details.title &&
        Math.abs(new Date(event.startDate).getTime() - startDate.getTime()) <
          60 * 1000,
    );
    if (alreadyAdded) {
      Alert.alert(
        "Déjà ajouté",
        "Cette compétition est déjà dans votre calendrier.",
      );
      return;
    }

    await Calendar.createEventAsync(defaultCalendar.id, {
      title: details.title,
      startDate,
      endDate,
      location: details.address
        ? `${details.address}, ${details.zipCode ?? ""} ${details.city ?? details.location}`
        : details.location,
      notes: details.description ?? undefined,
      timeZone: "Europe/Paris",
    });

    Alert.alert("Succès", "Ajouté au calendrier");
  } catch {
    Alert.alert("Erreur", "Impossible d'ajouter au calendrier.");
  }
}
