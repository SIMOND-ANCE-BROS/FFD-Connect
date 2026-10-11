import { EVENTS_SOURCE_NOTICES } from "../../../../constants/betaNotices";
import { getEventsSourceNotice } from "../eventsSourceNotice";

const CIRCULAR = "https://example.org/circulaire.pdf";

describe("getEventsSourceNotice", () => {
  it("returns no notice for a competition not synced from the federation", () => {
    expect(
      getEventsSourceNotice({ eventsSource: null, circularUrl: null }),
    ).toBeNull();
    expect(getEventsSourceNotice({ ffdId: "", circularUrl: CIRCULAR })).toBe(
      null,
    );
  });

  it("flags events deduced from the circular, with the circular link", () => {
    expect(
      getEventsSourceNotice({
        ffdId: "42",
        eventsSource: "CIRCULAR",
        circularUrl: CIRCULAR,
      }),
    ).toEqual({
      copy: EVENTS_SOURCE_NOTICES.deducedFromCircular,
      circularUrl: CIRCULAR,
    });
  });

  it("flags events deduced from the description, link only when known", () => {
    expect(
      getEventsSourceNotice({ ffdId: "42", eventsSource: "DESCRIPTION" }),
    ).toEqual({
      copy: EVENTS_SOURCE_NOTICES.deducedFromDescription,
      circularUrl: null,
    });
  });

  it.each([["GENERIC"], [null], [undefined], ["SOMETHING_NEW"]])(
    "source %s with a circular → unreadable circular notice",
    (eventsSource) => {
      expect(
        getEventsSourceNotice({
          ffdId: "42",
          eventsSource,
          circularUrl: CIRCULAR,
        }),
      ).toEqual({
        copy: EVENTS_SOURCE_NOTICES.circularUnreadable,
        circularUrl: CIRCULAR,
      });
    },
  );

  it.each([["GENERIC"], [null], [undefined]])(
    "source %s without circular → not yet published notice",
    (eventsSource) => {
      expect(
        getEventsSourceNotice({
          ffdId: "42",
          eventsSource,
          circularUrl: "  ",
        }),
      ).toEqual({
        copy: EVENTS_SOURCE_NOTICES.notYetPublished,
        circularUrl: null,
      });
    },
  );

  it("never claims the app is official or endorsed", () => {
    const texts = Object.values(EVENTS_SOURCE_NOTICES).flatMap((v) =>
      typeof v === "string" ? [v] : [v.title, v.message],
    );
    for (const text of texts) {
      expect(text).not.toMatch(/officiel(le)? (de|par) la FFD|partenaire/i);
      expect(text).not.toMatch(/application officielle|app officielle/i);
    }
  });
});
