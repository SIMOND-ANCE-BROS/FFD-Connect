import { theme } from "../../theme";
import {
  contrastRatio,
  meetsWcagAA,
  parseHexColor,
  relativeLuminance,
  WCAG_AA_LARGE_TEXT,
  WCAG_AA_NORMAL_TEXT,
} from "../contrast";

describe("contrast helpers", () => {
  it("parses 3- and 6-digit hex colours", () => {
    expect(parseHexColor("#fff")).toEqual([255, 255, 255]);
    expect(parseHexColor("004481")).toEqual([0, 68, 129]);
  });

  it("rejects unsupported formats", () => {
    expect(() => parseHexColor("rgba(0,0,0,1)")).toThrow(
      "Unsupported colour format",
    );
    expect(() => parseHexColor("#12345")).toThrow();
  });

  it("computes the WCAG luminance bounds", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#FFFFFF")).toBe(1);
  });

  it("returns 21:1 for black on white, in either order", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777", "#777")).toBe(1);
  });

  it("applies the normal and large text thresholds", () => {
    // #767676 on white is the classic 4.54:1 AA boundary.
    expect(meetsWcagAA("#767676", "#FFFFFF")).toBe(true);
    // #949494 on white is ~3.03:1 — large text only.
    expect(meetsWcagAA("#949494", "#FFFFFF")).toBe(false);
    expect(meetsWcagAA("#949494", "#FFFFFF", { largeText: true })).toBe(true);
    expect(WCAG_AA_NORMAL_TEXT).toBe(4.5);
    expect(WCAG_AA_LARGE_TEXT).toBe(3);
  });
});

/**
 * Regression guard for the theme (RGAA 3.2 / WCAG 1.4.3). These pairs are the
 * ones every screen relies on for body text; they must stay AA. Known failing
 * pairs (placeholders, semantic colours used as text on white, white on the
 * cyan/red buttons) are tracked on issue #22 and listed in `KNOWN_BELOW_AA`
 * so a future fix flips them into the guarded list.
 */
describe("theme contrast (WCAG AA)", () => {
  const { light, dark, colors } = theme;

  it.each([
    ["light: text on background", light.text, light.background],
    ["light: text on surface", light.text, light.surface],
    [
      "light: secondary text on background",
      light.textSecondary,
      light.background,
    ],
    ["light: secondary text on surface", light.textSecondary, light.surface],
    ["light: primary on background", light.primary, light.background],
    ["light: primary on surface", light.primary, light.surface],
    ["light: white on primary button", colors.white, colors.ffdBlue],
    ["dark: text on background", dark.text, dark.background],
    ["dark: text on surface", dark.text, dark.surface],
    ["dark: secondary text on background", dark.textSecondary, dark.background],
    ["dark: secondary text on surface", dark.textSecondary, dark.surface],
    ["dark: primary on background", dark.primary, dark.background],
    ["dark: primary on surface", dark.primary, dark.surface],
    ["dark: danger on surface", dark.danger, dark.surface],
  ])("%s meets AA", (_name, fg, bg) => {
    expect(meetsWcagAA(fg, bg)).toBe(true);
  });

  const KNOWN_BELOW_AA: [string, string, string][] = [
    ["light: placeholder on input", colors.slate400, colors.slate100],
    ["light: secondary text on input", light.textSecondary, colors.slate100],
    ["light: cyan on white", colors.ffdCyan, colors.white],
    ["light: white on danger button", colors.white, colors.error],
    ["light: success as text on white", colors.success, colors.white],
    ["light: warning as text on white", colors.warning, colors.white],
    ["dark: placeholder on input", colors.slate500, colors.slate800],
  ];

  it.each(KNOWN_BELOW_AA)(
    "%s is still below AA (update the list once fixed)",
    (_name, fg, bg) => {
      expect(meetsWcagAA(fg, bg)).toBe(false);
    },
  );
});
