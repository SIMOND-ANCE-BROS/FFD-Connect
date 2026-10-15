/**
 * Schedule times of the club editor (#442): the club types `HH:MM` with no
 * time zone. It is kept as typed (`ScheduleItem.startClock`, read back as
 * is) and turned into an instant (`ScheduleItem.startTime`) on the
 * competition's calendar day, French wall-clock time. Computed from UTC
 * instants and `Intl` with an explicit zone: independent of the server's.
 */

const TIME_ZONE = "Europe/Paris";

const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const PARTS_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const CLOCK_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});

/** Offset of Paris time from UTC at `instant`, in milliseconds. */
function parisOffsetMs(instant: number): number {
  const parts = PARTS_FORMAT.formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  const wallClockAsUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wallClockAsUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Instant of `clock` (`HH:MM`, Paris time) on the Paris calendar day of
 * `competitionDate`. Exact on daylight-saving days too (two passes).
 */
export function scheduleInstant(competitionDate: Date, clock: string): Date {
  const [year, month, day] = DAY_FORMAT.format(competitionDate)
    .split("-")
    .map(Number);
  const [hours, minutes] = clock.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hours, minutes);
  let instant = wallClockAsUtc - parisOffsetMs(wallClockAsUtc);
  instant = wallClockAsUtc - parisOffsetMs(instant);
  return new Date(instant);
}

/** `HH:MM` (Paris time) of an instant — for items saved before #442. */
export function parisClock(instant: Date): string {
  return CLOCK_FORMAT.format(instant);
}
