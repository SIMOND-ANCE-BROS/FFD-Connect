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
 * ones every screen relies on for body text; they must stay AA. Issue #22
 * fixed the pairs that were below AA (placeholders, semantic colours used as
 * text, white on the cyan/red buttons) by darkening only those tones.
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

  /*
   * Pairs that were below AA before issue #22 (ratio before → after). Inputs
   * use a slate100 fill in light mode and slate800 in dark mode (login,
   * register); semantic "text" tokens carry text, the plain fills stay for
   * badges, borders and tints.
   */
  it.each([
    // 2.34 → 4.97
    ["light: placeholder on input", light.placeholder, colors.slate100],
    // 4.34 → 4.97
    ["light: secondary text on input", light.textSecondary, colors.slate100],
    // 3.07 → 5.71
    ["dark: placeholder on input", dark.placeholder, colors.slate800],
    ["dark: secondary text on input", dark.textSecondary, colors.slate800],
    // 3.88 → 4.87
    ["light: cyan (secondary) on white", light.secondary, colors.white],
    [
      "light: cyan (secondary) on background",
      light.secondary,
      light.background,
    ],
    // 3.88 → 4.87 (end of the primary button gradient)
    ["white on the gradient end", colors.white, theme.gradients.primary[1]],
    ["white on the gradient start", colors.white, theme.gradients.primary[0]],
    // 3.76 → 4.83 (AppButton "danger" uses colors.error in both themes)
    ["white on danger button", colors.white, colors.error],
    ["light: danger as text on white", light.danger, colors.white],
    ["light: danger text on white", light.dangerText, colors.white],
    ["dark: danger text on surface", dark.dangerText, dark.surface],
    // 2.54 → 5.48
    ["light: success text on white", light.successText, colors.white],
    // 2.15 → 5.43
    ["light: warning text on white", light.warningText, colors.white],
    ["light: success text on background", light.successText, light.background],
    ["light: warning text on background", light.warningText, light.background],
    ["dark: success text on surface", dark.successText, dark.surface],
    ["dark: warning text on surface", dark.warningText, dark.surface],
    // White "QUALIFIÉ" badge in the live results
    ["white on the deep success badge", colors.white, colors.successDeep],
  ])("%s meets AA (#22)", (_name, fg, bg) => {
    expect(meetsWcagAA(fg, bg)).toBe(true);
  });

  /** Alpha-blends `hex` at `alpha` over the opaque `under` colour. */
  const tint = (hex: string, alpha: number, under: string): string => {
    const top = parseHexColor(hex);
    const bottom = parseHexColor(under);
    return `#${top
      .map((c, i) => Math.round(c * alpha + bottom[i] * (1 - alpha)))
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")}`;
  };

  // License-expiry / parental-consent banners: text tone on a ~10 % tint
  // (`${color}1A`) of the fill tone, over the light background.
  it.each([
    ["danger", light.dangerText, light.danger],
    ["warning", light.warningText, light.warning],
    ["success", light.successText, light.success],
  ])("light: %s text on its 10 %% tint meets AA", (_name, fg, fill) => {
    expect(meetsWcagAA(fg, tint(fill, 0x1a / 255, light.background))).toBe(
      true,
    );
  });

  // Solid fills of buttons, chips, badges and FABs (primaryFill) carry
  // onPrimary text. Dark mode: 3.88 (white on #0088CE) → 4.87 (#0077B6).
  it.each([
    ["light", light.onPrimary, light.primaryFill],
    ["dark", dark.onPrimary, dark.primaryFill],
  ])("%s: onPrimary on primaryFill meets AA (#22)", (_name, fg, bg) => {
    expect(meetsWcagAA(fg, bg)).toBe(true);
  });

  // Disabled buttons (TrackCorrectionModal, LicenseRenewalScreen, AppButton).
  // WCAG exempts disabled controls, the label stays AA anyway: white on
  // slate200 was 1.23:1 before issue #22.
  it.each([
    ["light", light.onDisabled, light.disabledFill],
    ["dark", dark.onDisabled, dark.disabledFill],
  ])("%s: onDisabled on disabledFill meets AA (#22)", (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  // Locked seats of the seating plan (DraggableLayoutItem, ItemPopupModal)
  // and the « Inactif » badge (ClubMemberEditorScreen) used white on
  // textSecondary: 2.56:1 in dark mode (slate400) before issue #22.
  it.each([
    ["light", light.onMuted, light.mutedFill],
    ["dark", dark.onMuted, dark.mutedFill],
  ])("%s: onMuted on mutedFill meets AA (#22)", (_name, fg, bg) => {
    expect(meetsWcagAA(fg, bg)).toBe(true);
  });

  it("dark: white on textSecondary stays below AA (use mutedFill)", () => {
    expect(meetsWcagAA(colors.white, dark.textSecondary)).toBe(false);
  });

  it("keeps the bright brand cyan for text and icons on dark surfaces", () => {
    expect(dark.primary).toBe(colors.ffdCyan);
    expect(dark.primaryFill).not.toBe(dark.primary);
    expect(contrastRatio(dark.onPrimary, dark.primaryFill)).toBeGreaterThan(
      contrastRatio(colors.white, colors.ffdCyan),
    );
  });
});
