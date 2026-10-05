/**
 * Rappels de deadline d'inscription (#300) — planification, annulation à
 * l'inscription, dé-marquage à la désinscription, purge des clés périmées.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import {
  cancelDeadlineNotification,
  cancelDeadlineNotificationForCompetition,
  clearDeadlineMarker,
  clearDeadlineStorage,
  deadlineStorageKey,
  REGISTERED_MARKER,
  scheduleDeadlineNotification,
} from "../scheduleDeadlineNotification";

// Mock local plus riche que le mock global de jest.setup.js : PermissionStatus
// est nécessaire (le code compare status !== PermissionStatus.GRANTED).
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  PermissionStatus: {
    GRANTED: "granted",
    DENIED: "denied",
    UNDETERMINED: "undetermined",
  },
  SchedulableTriggerInputTypes: { DATE: "date" },
}));

const getPermissions = Notifications.getPermissionsAsync as jest.Mock;
const requestPermissions = Notifications.requestPermissionsAsync as jest.Mock;
const schedule = Notifications.scheduleNotificationAsync as jest.Mock;
const cancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;

const COMP_ID = "comp-1";
const KEY = deadlineStorageKey(COMP_ID);

/** Deadline dans N jours (ISO). */
function deadlineInDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  getPermissions.mockResolvedValue({ status: "granted" });
  requestPermissions.mockResolvedValue({ status: "granted" });
  schedule.mockResolvedValue("notif-42");
  cancel.mockResolvedValue(undefined);
});

describe("scheduleDeadlineNotification", () => {
  it("planifie 3 jours avant la deadline et retourne l'id", async () => {
    const deadline = deadlineInDays(10);
    const id = await scheduleDeadlineNotification(
      COMP_ID,
      "Open de Lyon",
      deadline,
    );

    expect(id).toBe("notif-42");
    const call = schedule.mock.calls[0][0];
    expect(call.content.body).toContain("Open de Lyon");
    expect(call.content.data).toEqual({ competitionId: COMP_ID });
    const expected = new Date(deadline).getTime() - 3 * 24 * 60 * 60 * 1000;
    expect(call.trigger.date.getTime()).toBe(expected);
  });

  it("retourne null sans planifier si la permission est refusée", async () => {
    getPermissions.mockResolvedValue({ status: "undetermined" });
    requestPermissions.mockResolvedValue({ status: "denied" });

    const id = await scheduleDeadlineNotification(
      COMP_ID,
      "Open de Lyon",
      deadlineInDays(10),
    );

    expect(id).toBeNull();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("retourne null si la deadline est à moins de 3 jours", async () => {
    const id = await scheduleDeadlineNotification(
      COMP_ID,
      "Open de Lyon",
      deadlineInDays(2),
    );

    expect(id).toBeNull();
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe("cancelDeadlineNotificationForCompetition (inscription)", () => {
  it("annule le rappel planifié et pose le marqueur inscrit", async () => {
    await AsyncStorage.setItem(KEY, "notif-42");

    await cancelDeadlineNotificationForCompetition(COMP_ID);

    expect(cancel).toHaveBeenCalledWith("notif-42");
    expect(await AsyncStorage.getItem(KEY)).toBe(REGISTERED_MARKER);
  });

  it("pose le marqueur même sans rappel planifié", async () => {
    await cancelDeadlineNotificationForCompetition(COMP_ID);

    expect(cancel).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(KEY)).toBe(REGISTERED_MARKER);
  });

  it("n'annule rien si le marqueur est déjà posé (idempotent)", async () => {
    await AsyncStorage.setItem(KEY, REGISTERED_MARKER);

    await cancelDeadlineNotificationForCompetition(COMP_ID);

    expect(cancel).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(KEY)).toBe(REGISTERED_MARKER);
  });
});

describe("clearDeadlineMarker (désinscription)", () => {
  it("retire le marqueur inscrit", async () => {
    await AsyncStorage.setItem(KEY, REGISTERED_MARKER);

    await clearDeadlineMarker(COMP_ID);

    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it("conserve un vrai id de rappel encore planifié", async () => {
    await AsyncStorage.setItem(KEY, "notif-42");

    await clearDeadlineMarker(COMP_ID);

    expect(await AsyncStorage.getItem(KEY)).toBe("notif-42");
  });
});

describe("clearDeadlineStorage (deadline passée)", () => {
  it("purge la clé quelle que soit sa valeur", async () => {
    await AsyncStorage.setItem(KEY, "notif-42");

    await clearDeadlineStorage(COMP_ID);

    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });
});

describe("cancelDeadlineNotification", () => {
  it("ignore silencieusement une erreur d'annulation", async () => {
    cancel.mockRejectedValue(new Error("already fired"));
    await expect(
      cancelDeadlineNotification("notif-42"),
    ).resolves.toBeUndefined();
  });
});
