import { parisClock, scheduleInstant } from "./schedule-time";

describe("schedule time (#442)", () => {
  it("places HH:MM on the competition day, French summer time", () => {
    // Club-created competitions store their day at UTC midnight.
    const day = new Date("2026-06-13T00:00:00.000Z");
    expect(scheduleInstant(day, "10:00").toISOString()).toBe(
      "2026-06-13T08:00:00.000Z",
    );
  });

  it("uses winter time in winter", () => {
    const day = new Date("2026-12-05T00:00:00.000Z");
    expect(scheduleInstant(day, "09:30").toISOString()).toBe(
      "2026-12-05T08:30:00.000Z",
    );
  });

  it("is exact on the daylight-saving day", () => {
    // 29 March 2026: clocks go from 02:00 to 03:00 in France.
    const day = new Date("2026-03-29T00:00:00.000Z");
    expect(scheduleInstant(day, "10:00").toISOString()).toBe(
      "2026-03-29T08:00:00.000Z",
    );
    expect(scheduleInstant(day, "00:30").toISOString()).toBe(
      "2026-03-28T23:30:00.000Z",
    );
  });

  it("reads the Paris calendar day of an FFD instant", () => {
    // 23:30 UTC on the 12th is already the 13th in Paris.
    const day = new Date("2026-06-12T23:30:00.000Z");
    expect(scheduleInstant(day, "14:15").toISOString()).toBe(
      "2026-06-13T12:15:00.000Z",
    );
  });

  it("formats an instant back as Paris HH:MM", () => {
    expect(parisClock(new Date("2026-06-13T08:00:00.000Z"))).toBe("10:00");
    expect(parisClock(new Date("2026-12-04T23:05:00.000Z"))).toBe("00:05");
  });

  it("round-trips any clock", () => {
    const day = new Date("2026-10-25T00:00:00.000Z"); // back to winter time
    for (const clock of ["00:00", "08:45", "12:00", "23:59"]) {
      expect(parisClock(scheduleInstant(day, clock))).toBe(clock);
    }
  });
});
