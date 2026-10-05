/**
 * Ajout au calendrier (#298) — permission, choix du calendrier, création
 * d'événement, feedback utilisateur.
 */
import { Alert } from "react-native";
import * as Calendar from "expo-calendar/legacy";
import { addCompetitionToCalendar } from "../addToCalendar";

jest.mock("expo-calendar/legacy", () => ({
  requestCalendarPermissionsAsync: jest.fn(),
  getCalendarsAsync: jest.fn(),
  getEventsAsync: jest.fn(),
  createEventAsync: jest.fn(),
  EntityTypes: { EVENT: "event" },
}));

jest.mock("expo", () => ({
  PermissionStatus: {
    GRANTED: "granted",
    DENIED: "denied",
    UNDETERMINED: "undetermined",
  },
}));

const requestPermission = Calendar.requestCalendarPermissionsAsync as jest.Mock;
const getCalendars = Calendar.getCalendarsAsync as jest.Mock;
const getEvents = Calendar.getEventsAsync as jest.Mock;
const createEvent = Calendar.createEventAsync as jest.Mock;

const DETAILS = {
  title: "Open de Lyon",
  date: "2026-09-12T09:00:00.000Z",
  address: "12 rue de la Danse",
  zipCode: "69003",
  city: "Lyon",
  location: "Lyon",
  description: "Compétition régionale",
};

// iOS par défaut en jest (Platform.OS === "ios") : le calendrier "Default".
const IOS_DEFAULT_CALENDAR = {
  id: "cal-1",
  allowsModifications: true,
  source: { name: "Default" },
  isPrimary: false,
};

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  requestPermission.mockResolvedValue({ status: "granted" });
  getCalendars.mockResolvedValue([IOS_DEFAULT_CALENDAR]);
  getEvents.mockResolvedValue([]); // par défaut : pas de doublon existant
  createEvent.mockResolvedValue("event-1");
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe("addCompetitionToCalendar", () => {
  it("crée l'événement dans le calendrier par défaut (+8h, lieu complet)", async () => {
    await addCompetitionToCalendar(DETAILS);

    expect(createEvent).toHaveBeenCalledWith(
      "cal-1",
      expect.objectContaining({
        title: "Open de Lyon",
        location: "12 rue de la Danse, 69003 Lyon",
        notes: "Compétition régionale",
        timeZone: "Europe/Paris",
      }),
    );
    const { startDate, endDate } = createEvent.mock.calls[0][1];
    expect(endDate.getTime() - startDate.getTime()).toBe(8 * 60 * 60 * 1000);
    expect(alertSpy).toHaveBeenCalledWith("Succès", "Ajouté au calendrier");
  });

  it("permission refusée : alerte, aucun événement créé", async () => {
    requestPermission.mockResolvedValue({ status: "denied" });

    await addCompetitionToCalendar(DETAILS);

    expect(createEvent).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      "Permission requise",
      expect.stringContaining("calendrier"),
    );
  });

  it("aucun calendrier modifiable : alerte d'erreur", async () => {
    getCalendars.mockResolvedValue([
      { id: "cal-ro", allowsModifications: false, source: { name: "Default" } },
    ]);

    await addCompetitionToCalendar(DETAILS);

    expect(createEvent).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      "Erreur",
      "Aucun calendrier disponible.",
    );
  });

  it("retombe sur n'importe quel calendrier modifiable si pas de Default", async () => {
    getCalendars.mockResolvedValue([
      {
        id: "cal-2",
        allowsModifications: true,
        source: { name: "iCloud" },
        isPrimary: false,
      },
    ]);

    await addCompetitionToCalendar(DETAILS);

    expect(createEvent).toHaveBeenCalledWith("cal-2", expect.anything());
  });

  it("sans adresse : utilise location tel quel", async () => {
    await addCompetitionToCalendar({
      ...DETAILS,
      address: undefined,
      zipCode: undefined,
      city: undefined,
    });

    expect(createEvent).toHaveBeenCalledWith(
      "cal-1",
      expect.objectContaining({ location: "Lyon" }),
    );
  });

  it("doublon : événement déjà présent → n'en recrée pas un second", async () => {
    getEvents.mockResolvedValue([
      { title: "Open de Lyon", startDate: "2026-09-12T09:00:00.000Z" },
    ]);

    await addCompetitionToCalendar(DETAILS);

    expect(createEvent).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      "Déjà ajouté",
      expect.stringContaining("déjà"),
    );
  });

  it("erreur API : alerte d'erreur, pas de crash", async () => {
    createEvent.mockRejectedValue(new Error("boom"));

    await addCompetitionToCalendar(DETAILS);

    expect(alertSpy).toHaveBeenCalledWith(
      "Erreur",
      "Impossible d'ajouter au calendrier.",
    );
  });
});
