import { act, renderHook } from "@testing-library/react-native";
import { Alert } from "react-native";
import { CompetitionService } from "../../services/CompetitionService";
import {
  isValidCompetitionStatus,
  toCompetitionStatus,
  useClubCompetitionEditorLogic,
} from "../useClubCompetitionEditorLogic";

jest.mock("../../services/CompetitionService", () => ({
  CompetitionService: {
    create: jest.fn(),
    update: jest.fn(),
  },
}));

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

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  it("initializes with default state", async () => {
    const { result } = await renderHook(() =>
      useClubCompetitionEditorLogic({ navigation: mockNavigation }),
    );

    expect(result.current.title).toBe("");
    expect(result.current.status).toBe("DRAFT");
    expect(result.current.events.length).toBeGreaterThan(0);
    expect(result.current.schedule.length).toBeGreaterThan(0);
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
    expect(result.current.status).toBe("OPEN");
    expect(result.current.dateText).toBe("12/12/2025");
    expect(result.current.isEditing).toBe(true);
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
        useClubCompetitionEditorLogic({ navigation: mockNavigation }),
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
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({ navigation: mockNavigation }),
      );

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
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({ navigation: mockNavigation }),
      );

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
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({ navigation: mockNavigation }),
      );

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

    it("navigates back on successful save", async () => {
      const { result } = await renderHook(() =>
        useClubCompetitionEditorLogic({ navigation: mockNavigation }),
      );

      await act(() => {
        result.current.setTitle("Valid Title");
        result.current.setDateText("12/12/2024");
        result.current.setLocation("Paris");
      });

      (CompetitionService.create as jest.Mock).mockResolvedValueOnce({});

      await act(async () => {
        await result.current.handleSave();
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
