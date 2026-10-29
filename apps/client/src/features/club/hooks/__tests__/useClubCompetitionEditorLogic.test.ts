import { act, renderHook, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { queryClient } from "../../../../services/queryClient";
import { CompetitionService } from "../../services/CompetitionService";
import {
  CompetitionProgramError,
  fetchCompetitionProgram,
  saveCompetitionProgram,
} from "../../services/competitionProgramApi";
import {
  isValidCompetitionStatus,
  toCompetitionStatus,
  useClubCompetitionEditorLogic,
} from "../useClubCompetitionEditorLogic";
import { CLUB_COMPETITIONS_QUERY_ROOT } from "../useClubCompetitions";

jest.mock("../../services/CompetitionService", () => ({
  CompetitionService: {
    create: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock("../../services/competitionProgramApi", () => {
  class CompetitionProgramError extends Error {}
  return {
    CompetitionProgramError,
    fetchCompetitionProgram: jest.fn(),
    saveCompetitionProgram: jest.fn(),
  };
});

const emptyProgram = {
  competitionId: "comp-1",
  syncedFromFfd: false,
  eventsSource: null,
  programEditedAt: null,
  events: [],
  schedule: [],
};

/** Three slots: 10:00 (15 min), 10:15 (15 min), 10:30 (10 min). */
const sampleSchedule = [
  {
    id: "1",
    startTime: "10:00",
    type: "ROUND" as const,
    title: "Latine - Adulte - 1/4 Finale",
    duration: 15,
  },
  {
    id: "2",
    startTime: "10:15",
    type: "BREAK" as const,
    title: "Pause",
    duration: 15,
  },
  {
    id: "3",
    startTime: "10:30",
    type: "ROUND" as const,
    title: "Standard - Senior - Finale",
    duration: 10,
  },
];

describe("useClubCompetitionEditorLogic", () => {
  const mockNavigation = { goBack: jest.fn() };

  describe("isValidCompetitionStatus", () => {
    it("returns true for valid status values", () => {
      expect(isValidCompetitionStatus("DRAFT")).toBe(true);
      expect(isValidCompetitionStatus("OPEN")).toBe(true);
      expect(isValidCompetitionStatus("CLOSED")).toBe(true);
    });
    it("returns false for invalid status values", () => {
      expect(isValidCompetitionStatus("")).toBe(false);
      expect(isValidCompetitionStatus("INVALID")).toBe(false);
      expect(isValidCompetitionStatus("draft")).toBe(false);
    });
  });

  describe("toCompetitionStatus", () => {
    it("returns value when valid", () => {
      expect(toCompetitionStatus("OPEN")).toBe("OPEN");
      expect(toCompetitionStatus("CLOSED")).toBe("CLOSED");
    });
    it("returns DRAFT as default when invalid", () => {
      expect(toCompetitionStatus("INVALID")).toBe("DRAFT");
      expect(toCompetitionStatus("")).toBe("DRAFT");
    });
  });

  let invalidateSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
    invalidateSpy = jest
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    (fetchCompetitionProgram as jest.Mock).mockResolvedValue(emptyProgram);
    (saveCompetitionProgram as jest.Mock).mockResolvedValue(emptyProgram);
  });

  /** Editor of a new competition with a sample schedule. */
  const renderWithSchedule = () =>
    renderHook(() =>
      useClubCompetitionEditorLogic({
        initialCompetition: { schedule: sampleSchedule },
        navigation: mockNavigation,
      }),
    );

  it("initializes with default state", async () => {
    const { result } = await renderHook(() =>
      useClubCompetitionEditorLogic({ navigation: mockNavigation }),
    );

    expect(result.current.title).toBe("");
    expect(result.current.status).toBe("UPCOMING");
    expect(result.current.dateText).toBe("");
    // No sample programme: it would be saved as real events (#442).
    expect(result.current.events).toEqual([]);
    expect(result.current.schedule).toEqual([]);
    expect(result.current.programStatus).toBe("ready");
    expect(fetchCompetitionProgram).not.toHaveBeenCalled();
  });

  it("initializes with provided competition data", async () => {
    const initialData = {
      id: "123",
      title: "Existing Comp",
      status: "OPEN",
      date: "12/12/2025",
      location: "Paris",
    };

    const { result } = await renderHook(() =>
      useClubCompetitionEditorLogic({
        initialCompetition: initialData as never,
        navigation: mockNavigation,
      }),
    );

    expect(result.current.title).toBe("Existing Comp");
    // Legacy editor status mapped onto the API enum (#417).
    expect(result.current.status).toBe("UPCOMING");
    // Not an ISO date: shown as « Sélectionner une date », must be picked.
    expect(result.current.dateText).toBe("");
    expect(result.current.isEditing).toBe(true);
  });

  it("initializes the date from an ISO API date", async () => {
    const { result } = await renderHook(() =>
      useClubCompetitionEditorLogic({
        initialCompetition: {
          id: "c1",
          date: "2026-05-15T10:00:00.000Z",
          status: "PAST",
        },
        navigation: mockNavigation,
      }),
    );

    expect(result.current.status).toBe("PAST");
    expect(result.current.dateText).toBe("15 mai 2026");
    expect(result.current.date.toISOString()).toBe("2026-05-15T10:00:00.000Z");
  });

  describe("Events Management", () => {
    it("adds a new event", async () => {
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({ navigation: mockNavigation }),
      );

      const initialCount = result.current.events.length;

      await act(() => {
        result.current.setNewEventCategory("Standard");
        result.current.setNewEventType("Solo");
        result.current.setNewEventAge("Youth");
      });

      await act(() => {
        result.current.addEvent();
      });

      expect(result.current.events.length).toBe(initialCount + 1);
      const newEvent = result.current.events[result.current.events.length - 1];
      expect(newEvent.category).toBe("Standard");
      expect(newEvent.type).toBe("Solo");
      expect(newEvent.ageGroup).toBe("Youth");
      expect(result.current.showEventModal).toBe(false);
    });

    it("removes an event", async () => {
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({
          initialCompetition: {
            events: [
              {
                id: "e1",
                type: "Couple",
                category: "Latine",
                ageGroup: "Adulte",
              },
            ],
          },
          navigation: mockNavigation,
        }),
      );
      const eventId = result.current.events[0].id;

      await act(() => {
        result.current.removeEvent(eventId);
      });

      expect(
        result.current.events.find((e) => e.id === eventId),
      ).toBeUndefined();
    });
  });

  describe("Schedule Management", () => {
    it("adds a new timing item", async () => {
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({ navigation: mockNavigation }),
      );
      const initialCount = result.current.schedule.length;

      await act(() => {
        result.current.openTimingModal();
      });

      await act(() => {
        result.current.setNewTimingTitle("New Round");
        result.current.setNewTimingDuration("20");
      });

      await act(() => {
        result.current.saveTiming();
      });

      expect(result.current.schedule.length).toBe(initialCount + 1);
      const lastItem =
        result.current.schedule[result.current.schedule.length - 1];
      expect(lastItem.title).toBe("New Round");
      expect(lastItem.duration).toBe(20);
    });

    it("recalculates schedule times when adding item", async () => {
      const { result } = await renderWithSchedule();

      // Clear schedule for predictable testing
      // We can't clear explicitly via exposed methods easily without removing one by one,
      // effectively testing on default schedule

      // Default schedule has 3 items. Last one starts at 10:30, duration 10 -> Ends 10:40.
      // So new item should start at 10:40.

      await act(() => {
        result.current.openTimingModal();
      });

      expect(result.current.newTimeText).toBe("10:40");
    });

    it("edits an existing timing item and recalculates subsequent times", async () => {
      const { result } = await renderWithSchedule();

      // Default:
      // 1. 10:00 (15m) -> Ends 10:15
      // 2. 10:15 (15m) -> Ends 10:30
      // 3. 10:30 (10m)

      const firstItem = result.current.schedule[0];

      await act(() => {
        result.current.openTimingModal(firstItem);
      });

      await act(() => {
        result.current.setNewTimingDuration("30"); // Changed from 15 to 30
      });

      await act(() => {
        result.current.saveTiming();
      });

      // New Schedule:
      // 1. 10:00 (30m) -> Ends 10:30
      // 2. Should start at 10:30
      // 3. Should start at 10:30 + 15m = 10:45

      expect(result.current.schedule[0].duration).toBe(30);
      expect(result.current.schedule[1].startTime).toBe("10:30");
      expect(result.current.schedule[2].startTime).toBe("10:45");
    });

    it("removes a timing item and recalculates", async () => {
      const { result } = await renderWithSchedule();

      // Default:
      // 1. 10:00 (15m)
      // 2. 10:15 (15m)
      // 3. 10:30 (10m)

      const secondItem = result.current.schedule[1];

      await act(() => {
        result.current.removeTiming(secondItem.id);
      });

      // Should have 2 items
      // 1. 10:00 (15m) -> Ends 10:15
      // 3. Should now start at 10:15

      expect(result.current.schedule.length).toBe(2);
      expect(result.current.schedule[1].startTime).toBe("10:15");
    });

    it("shows alert when saveTiming called with empty title", async () => {
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({ navigation: mockNavigation }),
      );

      await act(() => {
        result.current.openTimingModal();
      });
      await act(() => {
        result.current.setNewTimingTitle("");
      });
      await act(() => {
        result.current.saveTiming();
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        "Erreur",
        "Veuillez nommer ce créneau",
      );
    });

    it("uses 10:00 when opening timing modal with empty schedule", async () => {
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({
          initialCompetition: { schedule: [] },
          navigation: mockNavigation,
        }),
      );

      await act(() => {
        result.current.openTimingModal();
      });

      expect(result.current.newTimeText).toBe("10:00");
    });
  });

  describe("Validation", () => {
    it("alerts error if required fields are missing on save", async () => {
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({ navigation: mockNavigation }),
      );

      await act(() => {
        result.current.setTitle(""); // Invalid
      });
      await act(async () => {
        await result.current.handleSave();
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        "Erreur",
        expect.stringContaining("champs obligatoires"),
      );
      expect(mockNavigation.goBack).not.toHaveBeenCalled();
    });

    it("alerts when no date was picked", async () => {
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({ navigation: mockNavigation }),
      );

      await act(() => {
        result.current.setTitle("Valid Title");
        result.current.setLocation("Paris");
      });
      await act(async () => {
        await result.current.handleSave();
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        "Erreur",
        expect.stringContaining("champs obligatoires"),
      );
      expect(CompetitionService.create).not.toHaveBeenCalled();
    });

    it("creates a competition with the API payload and navigates back (#417)", async () => {
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({ navigation: mockNavigation }),
      );

      await act(() => {
        result.current.setTitle("Valid Title");
        result.current.onDateChange(undefined, new Date(2024, 11, 12, 15));
        result.current.setLocation("Paris");
        result.current.setTicketingUrl("");
      });

      (CompetitionService.create as jest.Mock).mockResolvedValueOnce({
        id: "new-comp",
      });

      await act(async () => {
        await result.current.handleSave();
      });

      expect(CompetitionService.create).toHaveBeenCalledWith({
        title: "Valid Title",
        status: "UPCOMING",
        date: "2024-12-12",
        location: "Paris",
        type: "COMPETITION",
        competitionType: "PROXIMITE",
        eventsDescription: "",
        layout: [],
        requireRotatingQr: false,
      });
      // The programme goes through its own endpoint (#442).
      const body = (CompetitionService.create as jest.Mock).mock.calls[0][0];
      expect(body).not.toHaveProperty("events");
      expect(body).not.toHaveProperty("schedule");
      expect(saveCompetitionProgram).toHaveBeenCalledWith("new-comp", {
        events: [],
        schedule: [],
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        "Succès",
        expect.stringContaining("avec succès"),
        expect.any(Array),
      );

      // Simulate pressing OK
      const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
      const okButton = alertCall[2][0];
      okButton.onPress();

      expect(mockNavigation.goBack).toHaveBeenCalled();
      // The club list reloads on return, however the editor is left (#441).
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: CLUB_COMPETITIONS_QUERY_ROOT,
      });
    });

    it("loads and saves « QR tournant obligatoire » (#668)", async () => {
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({
          initialCompetition: {
            id: "comp-1",
            title: "Existing",
            status: "UPCOMING",
            date: "2026-05-15T00:00:00.000Z",
            location: "Lyon",
            competitionType: "NATIONALE",
            requireRotatingQr: true,
          },
          navigation: mockNavigation,
        }),
      );
      expect(result.current.requireRotatingQr).toBe(true);

      (CompetitionService.update as jest.Mock).mockResolvedValueOnce({});
      await waitFor(() => expect(result.current.programStatus).toBe("ready"));
      await act(() => {
        result.current.setRequireRotatingQr(false);
      });
      await act(async () => {
        await result.current.handleSave();
      });

      expect(CompetitionService.update).toHaveBeenCalledWith(
        "comp-1",
        expect.objectContaining({ requireRotatingQr: false }),
      );
    });

    it("updates an existing competition with the API payload (#417)", async () => {
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({
          initialCompetition: {
            id: "comp-1",
            title: "Existing",
            status: "UPCOMING",
            date: "2026-05-15T00:00:00.000Z",
            location: "Lyon",
            competitionType: "NATIONALE",
            ticketingUrl: "https://www.helloasso.com/x",
          },
          navigation: mockNavigation,
        }),
      );

      (CompetitionService.update as jest.Mock).mockResolvedValueOnce({});
      await waitFor(() => expect(result.current.programStatus).toBe("ready"));

      await act(async () => {
        await result.current.handleSave();
      });

      expect(CompetitionService.create).not.toHaveBeenCalled();
      expect(CompetitionService.update).toHaveBeenCalledWith("comp-1", {
        title: "Existing",
        status: "UPCOMING",
        date: expect.stringMatching(/^2026-05-1[45]$/),
        location: "Lyon",
        type: "COMPETITION",
        competitionType: "NATIONALE",
        majorSubType: null,
        eventsDescription: "",
        ticketingUrl: "https://www.helloasso.com/x",
        layout: [],
        requireRotatingQr: false,
      });
    });

    it("alerts when the API rejects the save", async () => {
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({ navigation: mockNavigation }),
      );

      await act(() => {
        result.current.setTitle("Valid Title");
        result.current.onDateChange(undefined, new Date(2024, 11, 12));
        result.current.setLocation("Paris");
      });
      (CompetitionService.create as jest.Mock).mockRejectedValueOnce(
        new Error("400"),
      );

      await act(async () => {
        await result.current.handleSave();
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        "Erreur",
        "Impossible de sauvegarder la compétition",
      );
      expect(mockNavigation.goBack).not.toHaveBeenCalled();
      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });

  describe("Programme (#442)", () => {
    const storedProgram = {
      ...emptyProgram,
      syncedFromFfd: true,
      events: [
        {
          id: "ev-1",
          eventKind: "OPEN",
          eventType: "COUPLE",
          category: "Standard",
          ageGroup: "Youth",
          ageGroups: ["Youth", "Adulte"],
          level: null,
          openLevels: ["Débutant"],
          locked: false,
          resultCount: 0,
        },
        {
          id: "ev-ffd",
          eventKind: null,
          eventType: "COUPLE",
          category: "Latin",
          ageGroup: "Adult",
          ageGroups: [],
          level: null,
          openLevels: [],
          locked: true,
          resultCount: 0,
        },
      ],
      schedule: [
        {
          id: "slot-1",
          startTime: "09:00",
          durationMinutes: 30,
          type: "ROUND",
          title: "Ouverture",
          eventId: null,
        },
      ],
    };

    const renderExisting = () =>
      renderHook(() =>
        useClubCompetitionEditorLogic({
          initialCompetition: {
            id: "comp-1",
            title: "Open de Lyon",
            date: "2026-06-13T00:00:00.000Z",
            location: "Lyon",
            competitionType: "NATIONALE",
          },
          navigation: mockNavigation,
        }),
      );

    it("loads the stored programme of an existing competition", async () => {
      (fetchCompetitionProgram as jest.Mock).mockResolvedValue(storedProgram);
      const { result } = await renderExisting();

      expect(fetchCompetitionProgram).toHaveBeenCalledWith("comp-1");
      await waitFor(() => expect(result.current.programStatus).toBe("ready"));
      expect(result.current.syncedFromFfd).toBe(true);
      expect(result.current.events.map((e) => e.id)).toEqual([
        "ev-1",
        "ev-ffd",
      ]);
      expect(result.current.events[0]).toMatchObject({
        type: "Couple",
        kind: "OPEN",
        ageGroups: ["Youth", "Adulte"],
        openLevels: ["Débutant"],
        persisted: true,
      });
      expect(result.current.schedule).toEqual([
        {
          id: "slot-1",
          startTime: "09:00",
          type: "ROUND",
          title: "Ouverture",
          duration: 30,
          persisted: true,
        },
      ]);
    });

    it("sends stored events back with their id and values, new ones without id", async () => {
      (fetchCompetitionProgram as jest.Mock).mockResolvedValue(storedProgram);
      (CompetitionService.update as jest.Mock).mockResolvedValue({});
      const { result } = await renderExisting();
      await waitFor(() => expect(result.current.programStatus).toBe("ready"));

      await act(() => {
        result.current.setNewEventKind("CLASSIFICATRICE");
        result.current.setNewEventCategory("Latine");
        result.current.setNewEventAge("Youth");
        result.current.setNewEventLevel("Avancé");
      });
      await act(() => {
        result.current.addEvent();
      });
      await act(async () => {
        await result.current.handleSave();
      });

      expect(saveCompetitionProgram).toHaveBeenCalledWith("comp-1", {
        events: [
          {
            id: "ev-1",
            eventKind: "OPEN",
            eventType: "COUPLE",
            category: "Standard",
            ageGroup: "Youth",
            ageGroups: ["Youth", "Adulte"],
            level: null,
            openLevels: ["Débutant"],
          },
          {
            id: "ev-ffd",
            eventKind: null,
            eventType: "COUPLE",
            category: "Latin",
            ageGroup: "Adult",
            ageGroups: [],
            level: null,
            openLevels: [],
          },
          {
            eventKind: "CLASSIFICATRICE",
            eventType: "COUPLE",
            category: "Latine",
            ageGroup: "Youth",
            ageGroups: [],
            level: "Avancé",
            openLevels: [],
          },
        ],
        schedule: [
          {
            id: "slot-1",
            startTime: "09:00",
            durationMinutes: 30,
            type: "ROUND",
            title: "Ouverture",
          },
        ],
      });
      expect(Alert.alert).toHaveBeenCalledWith(
        "Succès",
        "Compétition modifiée avec succès !",
        expect.any(Array),
      );
    });

    it("keeps an event with registrations", async () => {
      (fetchCompetitionProgram as jest.Mock).mockResolvedValue(storedProgram);
      const { result } = await renderExisting();
      await waitFor(() => expect(result.current.programStatus).toBe("ready"));

      await act(() => {
        result.current.removeEvent("ev-ffd");
      });

      expect(result.current.events.map((e) => e.id)).toContain("ev-ffd");
      expect(Alert.alert).toHaveBeenCalledWith(
        "Épreuve verrouillée",
        expect.any(String),
      );
    });

    it("waits for the programme before saving", async () => {
      (fetchCompetitionProgram as jest.Mock).mockReturnValue(
        new Promise(() => {}),
      );
      const { result } = await renderExisting();

      await act(async () => {
        await result.current.handleSave();
      });

      expect(result.current.programStatus).toBe("loading");
      expect(CompetitionService.update).not.toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenCalledWith(
        "Patientez",
        expect.stringContaining("en cours de chargement"),
      );
    });

    it("never overwrites a programme it could not load", async () => {
      (fetchCompetitionProgram as jest.Mock).mockRejectedValue(
        new Error("500"),
      );
      (CompetitionService.update as jest.Mock).mockResolvedValue({});
      const { result } = await renderExisting();
      await waitFor(() => expect(result.current.programStatus).toBe("error"));

      await act(async () => {
        await result.current.handleSave();
      });

      expect(CompetitionService.update).toHaveBeenCalled();
      expect(saveCompetitionProgram).not.toHaveBeenCalled();
    });

    it("does not save a programme for a non-competitive event", async () => {
      (CompetitionService.update as jest.Mock).mockResolvedValue({});
      const { result } = await renderExisting();
      await waitFor(() => expect(result.current.programStatus).toBe("ready"));

      await act(() => {
        result.current.setKind("EVENT");
      });
      await act(async () => {
        await result.current.handleSave();
      });

      expect(CompetitionService.update).toHaveBeenCalled();
      expect(saveCompetitionProgram).not.toHaveBeenCalled();
    });

    it("shows the server's reason and stays open when the programme is refused", async () => {
      (CompetitionService.update as jest.Mock).mockResolvedValue({});
      (saveCompetitionProgram as jest.Mock).mockRejectedValue(
        new CompetitionProgramError(
          "L'épreuve « Latines Adulte » a des inscriptions ou des résultats : elle ne peut plus être modifiée.",
        ),
      );
      const { result } = await renderExisting();
      await waitFor(() => expect(result.current.programStatus).toBe("ready"));

      await act(async () => {
        await result.current.handleSave();
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        "Épreuves non enregistrées",
        expect.stringContaining("a des inscriptions"),
      );
      expect(mockNavigation.goBack).not.toHaveBeenCalled();
    });

    it("updates (no duplicate) on retry after a creation whose programme failed", async () => {
      (CompetitionService.create as jest.Mock).mockResolvedValue({
        id: "new-comp",
      });
      (CompetitionService.update as jest.Mock).mockResolvedValue({});
      (saveCompetitionProgram as jest.Mock).mockRejectedValueOnce(
        new Error("network"),
      );
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({ navigation: mockNavigation }),
      );
      await act(() => {
        result.current.setTitle("Gala");
        result.current.onDateChange(undefined, new Date(2026, 5, 13));
        result.current.setLocation("Lyon");
      });

      await act(async () => {
        await result.current.handleSave();
      });
      expect(Alert.alert).toHaveBeenLastCalledWith(
        "Épreuves non enregistrées",
        expect.stringContaining(
          "Impossible d'enregistrer les épreuves et le planning",
        ),
      );
      expect(result.current.isEditing).toBe(true);

      await act(async () => {
        await result.current.handleSave();
      });

      expect(CompetitionService.create).toHaveBeenCalledTimes(1);
      expect(CompetitionService.update).toHaveBeenCalledWith(
        "new-comp",
        expect.objectContaining({ title: "Gala" }),
      );
      expect(saveCompetitionProgram).toHaveBeenLastCalledWith("new-comp", {
        events: [],
        schedule: [],
      });
    });
  });

  describe("Layout Management", () => {
    it("duplicates a layout item with offset position and updated label", async () => {
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({ navigation: mockNavigation }),
      );

      await act(() => {
        result.current.openLayoutModal(undefined, "TABLE");
      });
      await act(() => {
        result.current.setNewLayoutLabel("Table 1");
        result.current.setNewLayoutCapacity("8");
      });
      await act(() => {
        result.current.addLayoutItem();
      });

      const original = result.current.layoutItems[0];
      expect(original.label).toBe("Table 1");

      await act(() => {
        result.current.duplicateLayoutItem(original.id);
      });

      expect(result.current.layoutItems.length).toBe(2);
      const duplicated = result.current.layoutItems[1];
      expect(duplicated.label).toBe("Table 2");
      expect(duplicated.id).not.toBe(original.id);
      expect(duplicated.x).toBeGreaterThanOrEqual(original.x);
      expect(duplicated.y).toBeGreaterThanOrEqual(original.y);
    });

    it("cycles layout item orientation and swaps width/height", async () => {
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({ navigation: mockNavigation }),
      );

      await act(() => {
        result.current.openLayoutModal(undefined, "TABLE");
      });
      await act(() => {
        result.current.setNewLayoutLabel("Table A");
        result.current.setNewLayoutCapacity("6");
      });
      await act(() => {
        result.current.addLayoutItem();
      });

      const item = result.current.layoutItems[0];
      const { id, width, height, orientation } = item;

      await act(() => {
        result.current.cycleLayoutItemOrientation(id);
      });

      const updated = result.current.layoutItems[0];
      expect(updated.width).toBe(height);
      expect(updated.height).toBe(width);
      expect(updated.orientation).not.toBe(orientation);
    });
  });
});
