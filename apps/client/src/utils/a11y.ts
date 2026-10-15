/**
 * Screen-reader label helpers (VoiceOver / TalkBack).
 *
 * A card that is one touchable merges its children into a single
 * accessibility element; without an explicit label the reader concatenates
 * every Text in visual order, including decorative bits ("·", icons' empty
 * strings, all-caps badges). These helpers build one clean, comma-separated
 * sentence instead — commas give the reader a short pause.
 */

export type A11yPart = string | number | null | undefined | false;

/** Joins the non-empty parts with ", " (trimmed, empty parts dropped). */
export function joinA11yLabel(parts: readonly A11yPart[]): string {
  return parts
    .filter(
      (part): part is string | number =>
        part !== null && part !== undefined && part !== false,
    )
    .map((part) => String(part).trim())
    .filter((part) => part.length > 0)
    .join(", ");
}

/**
 * Turns an all-caps visual badge ("EN DIRECT", "À VENIR") into sentence case
 * so the reader does not spell it letter by letter on some voices.
 */
export function toSpokenCase(text: string): string {
  const lower = text.trim().toLocaleLowerCase("fr-FR");
  return lower.charAt(0).toLocaleUpperCase("fr-FR") + lower.slice(1);
}

/**
 * Spoken duration: "1 minute 5 secondes" rather than "1:05" (which some
 * voices read as a clock time or a ratio). Negative / NaN → "0 seconde".
 */
export function formatSpokenDuration(totalSeconds: number): string {
  const safe =
    Number.isFinite(totalSeconds) && totalSeconds > 0
      ? Math.floor(totalSeconds)
      : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;
  if (minutes === 0) return plural(seconds, "seconde");
  if (seconds === 0) return plural(minutes, "minute");
  return `${plural(minutes, "minute")} ${plural(seconds, "seconde")}`;
}
