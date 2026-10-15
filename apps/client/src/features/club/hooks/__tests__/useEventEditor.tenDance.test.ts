import { act, renderHook } from "@testing-library/react-native";
import { Alert } from "react-native";
import { buildProgramPayload } from "../competitionProgram";
import {
  TEN_DANCE_CATEGORY,
  categoryOptionsForKind,
  coupleAgesForCategory,
  type CompetitionType,
} from "../useClubCompetitionEditorLogic.types";
import { useEventEditor } from "../useEventEditor";

const renderEditor = (competitionType: CompetitionType = "NATIONALE") =>
  renderHook(() =>
    useEventEditor({
      competitionType,
      majorSubType: null,
      setMajorSubType: jest.fn(),
    }),
  );

describe("« 10 danses » events in the club editor (#639)", () => {
  beforeEach(() => {
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("categoryOptionsForKind", () => {
    it("offers 10 danses for a majeure event only", () => {
      expect(categoryOptionsForKind("MAJEURE")).toEqual([
        "Latine",
        "Standard",
        TEN_DANCE_CATEGORY,
      ]);
      for (const kind of [
        "CLASSIFICATRICE",
        "OPEN",
        "SHOW_DANSE",
        "SOLO_TEAM",
      ] as const) {
        expect(categoryOptionsForKind(kind)).not.toContain(TEN_DANCE_CATEGORY);
      }
    });
  });

  describe("coupleAgesForCategory", () => {
    it("keeps Senior V in Standard and 10 danses, drops it in Latin", () => {
      expect(coupleAgesForCategory("Latine")).not.toContain("Senior V");
      expect(coupleAgesForCategory("Standard")).toContain("Senior V");
      expect(coupleAgesForCategory(TEN_DANCE_CATEGORY)).toContain("Senior V");
    });
  });

  it("does not offer 10 danses for the default classificatrice kind", async () => {
    const { result } = await renderEditor();
    expect(result.current.categoryOptionsForNewEvent).not.toContain(
      TEN_DANCE_CATEGORY,
    );
  });

  it("adds a 10 danses majeure event without level, sent as « Ten Dance »", async () => {
    const { result } = await renderEditor();

    await act(() => {
      result.current.setNewEventKind("MAJEURE");
    });
    expect(result.current.categoryOptionsForNewEvent).toContain(
      TEN_DANCE_CATEGORY,
    );
    expect(result.current.levelOptionsForNewEvent).toEqual([]);

    await act(() => {
      result.current.setNewEventCategory(TEN_DANCE_CATEGORY);
      result.current.setNewEventAge("Senior V");
    });
    expect(result.current.ageOptionsForNewEvent).toContain("Senior V");

    await act(() => {
      result.current.addEvent();
    });

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(result.current.events).toHaveLength(1);
    const [event] = result.current.events;
    expect(event).toMatchObject({
      kind: "MAJEURE",
      type: "Couple",
      category: TEN_DANCE_CATEGORY,
      ageGroup: "Senior V",
    });
    expect(event.level).toBeUndefined();

    const payload = buildProgramPayload(result.current.events, []);
    expect(payload.events[0]).toMatchObject({
      eventKind: "MAJEURE",
      eventType: "COUPLE",
      category: "Ten Dance",
      ageGroup: "Senior V",
      level: null,
    });
  });

  it("falls back to Latines when the kind is no longer majeure", async () => {
    const { result } = await renderEditor();

    await act(() => {
      result.current.setNewEventKind("MAJEURE");
    });
    await act(() => {
      result.current.setNewEventCategory(TEN_DANCE_CATEGORY);
    });
    await act(() => {
      result.current.setNewEventKind("CLASSIFICATRICE");
    });

    expect(result.current.newEventCategory).toBe("Latine");
    expect(result.current.categoryOptionsForNewEvent).not.toContain(
      TEN_DANCE_CATEGORY,
    );
  });

  it("is never offered in a proximité competition (no majeure kind)", async () => {
    const { result } = await renderEditor("PROXIMITE");
    expect(result.current.allowedEventKindsForCurrentCompetition).not.toContain(
      "MAJEURE",
    );
    expect(result.current.categoryOptionsForNewEvent).not.toContain(
      TEN_DANCE_CATEGORY,
    );
  });
});
