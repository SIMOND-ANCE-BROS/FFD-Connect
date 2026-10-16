import {
  buildCompetitionPayload,
  buildCompetitionUpdatePayload,
  parseCompetitionDate,
  toApiCompetitionStatus,
  toApiDate,
  type CompetitionEditorForm,
} from "../competitionPayload";

const baseForm: CompetitionEditorForm = {
  kind: "COMPETITION",
  title: "Open de Lyon",
  status: "UPCOMING",
  date: new Date(2026, 9, 12, 23, 30), // late evening: must not shift a day
  location: "Lyon",
  competitionType: "PROXIMITE",
  majorSubType: null,
  eventsDescription: "",
  ticketingUrl: "",
  requireRotatingQr: false,
  layoutItems: [
    {
      id: "t1",
      type: "TABLE",
      label: "Table 1",
      capacity: 8,
      x: 10,
      y: 10,
      width: 15,
      height: 10,
    },
  ],
};

describe("competitionPayload (#417)", () => {
  describe("buildCompetitionPayload — « Compétition »", () => {
    it("matches the POST /competitions contract exactly", () => {
      expect(buildCompetitionPayload(baseForm)).toEqual({
        title: "Open de Lyon",
        status: "UPCOMING",
        date: "2026-10-12",
        location: "Lyon",
        type: "COMPETITION",
        competitionType: "PROXIMITE",
        eventsDescription: "",
        requireRotatingQr: false,
        layout: baseForm.layoutItems,
      });
    });

    it("sends the « QR tournant obligatoire » setting (#668)", () => {
      expect(
        buildCompetitionPayload({ ...baseForm, requireRotatingQr: true })
          .requireRotatingQr,
      ).toBe(true);
      expect(
        buildCompetitionUpdatePayload({
          ...baseForm,
          kind: "EVENT",
          requireRotatingQr: true,
        }).requireRotatingQr,
      ).toBe(true);
    });

    it("never sends events or schedule (no backend persistence yet)", () => {
      const payload = buildCompetitionPayload(baseForm);
      expect(payload).not.toHaveProperty("events");
      expect(payload).not.toHaveProperty("schedule");
    });

    it("sends the major sub-type only for a MAJEURE competition", () => {
      expect(
        buildCompetitionPayload({
          ...baseForm,
          competitionType: "MAJEURE",
          majorSubType: "CHAMPIONNAT_REGIONAL",
        }),
      ).toMatchObject({
        competitionType: "MAJEURE",
        majorSubType: "CHAMPIONNAT_REGIONAL",
      });
      expect(
        buildCompetitionPayload({
          ...baseForm,
          majorSubType: "CHAMPIONNAT_REGIONAL",
        }),
      ).not.toHaveProperty("majorSubType");
    });

    it("sends a trimmed ticketing URL and omits an empty one", () => {
      expect(
        buildCompetitionPayload({
          ...baseForm,
          ticketingUrl: "  https://www.helloasso.com/x  ",
        }).ticketingUrl,
      ).toBe("https://www.helloasso.com/x");
      expect(
        buildCompetitionPayload({ ...baseForm, ticketingUrl: "   " }),
      ).not.toHaveProperty("ticketingUrl");
    });

    it("maps legacy editor statuses to the API enum", () => {
      expect(
        buildCompetitionPayload({ ...baseForm, status: "DRAFT" }).status,
      ).toBe("UPCOMING");
    });
  });

  describe("buildCompetitionPayload — « Événement »", () => {
    it("omits the competition-only fields", () => {
      expect(
        buildCompetitionPayload({
          ...baseForm,
          kind: "EVENT",
          competitionType: "MAJEURE",
          majorSubType: "CHAMPIONNAT_REGIONAL",
          eventsDescription: "Soirée",
        }),
      ).toEqual({
        title: "Open de Lyon",
        status: "UPCOMING",
        date: "2026-10-12",
        location: "Lyon",
        type: "EVENT",
        eventsDescription: "Soirée",
        requireRotatingQr: false,
      });
    });
  });

  describe("buildCompetitionUpdatePayload", () => {
    it("clears the major sub-type with null when not MAJEURE", () => {
      expect(buildCompetitionUpdatePayload(baseForm).majorSubType).toBeNull();
    });

    it("keeps the major sub-type of a MAJEURE competition", () => {
      expect(
        buildCompetitionUpdatePayload({
          ...baseForm,
          competitionType: "MAJEURE",
          majorSubType: "CRITERIUMS_NATIONAUX",
        }).majorSubType,
      ).toBe("CRITERIUMS_NATIONAUX");
    });

    it("does not touch the major sub-type of an « Événement »", () => {
      expect(
        buildCompetitionUpdatePayload({ ...baseForm, kind: "EVENT" }),
      ).not.toHaveProperty("majorSubType");
    });
  });

  describe("toApiCompetitionStatus", () => {
    it.each([
      ["UPCOMING", "UPCOMING"],
      ["LIVE", "LIVE"],
      ["PAST", "PAST"],
      ["CANCELLED", "CANCELLED"],
      ["DRAFT", "UPCOMING"],
      ["OPEN", "UPCOMING"],
      ["CLOSED", "PAST"],
    ] as const)("%s → %s", (status, expected) => {
      expect(toApiCompetitionStatus(status)).toBe(expected);
    });
  });

  describe("toApiDate", () => {
    it("formats the local calendar day as YYYY-MM-DD", () => {
      expect(toApiDate(new Date(2026, 0, 5, 0, 15))).toBe("2026-01-05");
    });
  });

  describe("parseCompetitionDate", () => {
    it("parses an ISO date from the API", () => {
      const parsed = parseCompetitionDate("2026-05-15T10:00:00.000Z");
      expect(parsed?.toISOString()).toBe("2026-05-15T10:00:00.000Z");
    });

    it.each([undefined, "", "12 Mars 2026", "12/12/2025", "2026-13-45"])(
      "returns null for %p",
      (value) => {
        expect(parseCompetitionDate(value)).toBeNull();
      },
    );
  });
});
