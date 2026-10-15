/**
 * WCAG 2.x colour-contrast helpers (RGAA criterion 3.2 relies on the same
 * formula). Used by the theme contrast tests to keep text/background pairs
 * readable; pure functions, no React Native dependency.
 */

/** WCAG AA minimum for body text. */
export const WCAG_AA_NORMAL_TEXT = 4.5;
/** WCAG AA minimum for large text (>= 18.66px bold / 24px) and UI components. */
export const WCAG_AA_LARGE_TEXT = 3;

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parses `#RGB` / `#RRGGBB` into 0-255 channels. Throws on anything else. */
export function parseHexColor(hex: string): [number, number, number] {
  const match = HEX_PATTERN.exec(hex.trim());
  if (!match) {
    throw new Error(`Unsupported colour format: ${hex}`);
  }
  const raw = match[1];
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Relative luminance as defined by WCAG 2.x (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexColor(hex).map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, from 1 (identical) to 21. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/** True when the pair meets WCAG AA for the given text size. */
export function meetsWcagAA(
  foreground: string,
  background: string,
  { largeText = false }: { largeText?: boolean } = {},
): boolean {
  const threshold = largeText ? WCAG_AA_LARGE_TEXT : WCAG_AA_NORMAL_TEXT;
  return contrastRatio(foreground, background) >= threshold;
}
