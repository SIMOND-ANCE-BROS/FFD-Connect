const palette = {
  // Brand Colors (FFD Official + Premium)
  ffdBlue: "#004481", // Deep Royal Blue
  ffdCyan: "#0088CE", // Bright Cyan — text/accents on dark surfaces only
  // Darker cyan for light surfaces and under white text: #0088CE only reaches
  // 3.88:1 against white, this tone reaches 4.87:1 (WCAG AA, issue #22).
  ffdCyanDeep: "#0077B6",
  ffdRed: "#E30613", // Official Red

  // Neutrals (Slate - Premium Blue-Grays)
  slate50: "#F8FAFC",
  slate100: "#F1F5F9",
  slate200: "#E2E8F0",
  slate300: "#CBD5E1",
  slate400: "#94A3B8",
  slate500: "#64748B",
  // Between slate500 and slate600: secondary text and placeholders in light
  // mode. slate500 drops to 4.34:1 on the slate100 input fill, this reaches
  // 4.97:1 (5.44:1 on white).
  slate550: "#5B6B80",
  slate600: "#475569",
  slate700: "#334155",
  slate800: "#1E293B",
  slate900: "#0F172A",
  slate950: "#020617", // Rich Dark background

  white: "#FFFFFF",
  black: "#000000",

  // Semantic — fills (badges, borders, icons, tinted backgrounds).
  success: "#10B981", // Emerald
  warning: "#F59E0B", // Amber
  // Danger fill: white text on it reaches 4.83:1 (#EF4444 was 3.76:1).
  error: "#DC2626",
  // Brighter red for danger text on dark surfaces (4.74:1 on slate900).
  errorBright: "#EF4444",

  // Semantic text variants for light surfaces (WCAG AA 4.5:1 on white). The
  // fills above stay for badges; these darker tones carry text and are also
  // the fill whenever white text sits on a green/amber badge.
  successDeep: "#047857", // 5.48:1 on white
  warningDeep: "#AD4E08", // 5.43:1 on white, AA on its 10 % tint too
  errorDeep: "#C81E1E", // 4.91:1 on a 10 % red tint, 5.9:1 on white

  // Podium medals — top-3 ranking badges (career palmarès + live results).
  // Single source of truth: consumed via getPodiumStyle (utils/podium.ts).
  // Metallic hues are theme-independent (a medal reads the same in light/dark);
  // pair with slate900 ink for AA-legible rank numbers on the badge.
  gold: "#FFD700",
  silver: "#C0C0C0",
  bronze: "#CD7F32",
};

export const theme = {
  light: {
    background: palette.slate50,
    surface: palette.white,
    text: palette.slate900,
    textSecondary: palette.slate550,
    // Input placeholder (inputs sit on slate100 in light mode).
    placeholder: palette.slate550,
    primary: palette.ffdBlue,
    secondary: palette.ffdCyanDeep,
    accent: palette.ffdRed,
    border: palette.slate200,
    inputBackground: palette.white,
    statusBarStyle: "dark-content" as const,
    dark: false,
    // Semantic aliases — fills
    success: palette.success,
    warning: palette.warning,
    danger: palette.error,
    // Semantic aliases — text on surface/background (WCAG AA)
    successText: palette.successDeep,
    warningText: palette.warningDeep,
    dangerText: palette.errorDeep,
  },
  dark: {
    background: palette.slate950,
    surface: palette.slate900,
    text: palette.slate50,
    textSecondary: palette.slate400,
    // Input placeholder (inputs sit on slate800 in dark mode): slate500 was
    // 3.07:1 there, slate400 reaches 5.71:1.
    placeholder: palette.slate400,
    primary: palette.ffdCyan, // Lighter blue pops better on dark
    secondary: palette.ffdBlue,
    accent: palette.ffdRed,
    border: palette.slate800,
    inputBackground: palette.slate900,
    statusBarStyle: "light-content" as const,
    dark: true,
    // Semantic aliases — fills
    success: palette.success,
    warning: palette.warning,
    danger: palette.errorBright,
    // Semantic aliases — text on surface/background (bright tones pass AA on
    // the dark surfaces)
    successText: palette.success,
    warningText: palette.warning,
    dangerText: palette.errorBright,
  },
  colors: palette,
  /**
   * Brand gradient of the primary buttons / segmented tabs. White text sits on
   * it, so it ends on the deep cyan (4.87:1) rather than #0088CE (3.88:1).
   */
  gradients: {
    primary: [palette.ffdBlue, palette.ffdCyanDeep] as const,
  },
  spacing: {
    xxs: 2,
    xs: 4,
    s: 8,
    sm: 12,
    m: 16,
    md: 20,
    l: 24,
    xl: 32,
    xxl: 48,
    xxxl: 64,
  },
  borderRadius: {
    s: 6,
    m: 12, // More modern
    l: 20,
    xl: 30, // Use sparingly — only for hero cards / "premium" surfaces
    full: 9999, // Pills, avatars
  },
  /**
   * Elevation tokens (iOS shadowColor + Android elevation combined).
   * Use these instead of inline shadow values for visual consistency.
   *
   *   elevation0 — flat (cards on surface)
   *   elevation1 — subtle lift (default cards)
   *   elevation2 — interactive lift (hovered, pressed)
   *   elevation3 — modal / dropdown
   *
   * iOS only renders shadows; Android only renders elevation.
   * Both are set so it works cross-platform.
   */
  elevation: {
    0: {
      shadowColor: "transparent",
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
      elevation: 0,
    },
    1: {
      shadowColor: palette.slate900,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    2: {
      shadowColor: palette.slate900,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 4,
    },
    3: {
      shadowColor: palette.slate900,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.12,
      shadowRadius: 16,
      elevation: 8,
    },
  },
  typography: {
    fontFamily: "DMSans-Regular", // Global default (if supported by custom Text component)
    h1: {
      fontFamily: "DMSans-Bold",
      fontSize: 32,
      fontWeight: "700", // Bold
      letterSpacing: -0.5,
    },
    h2: {
      fontFamily: "DMSans-Bold",
      fontSize: 24,
      fontWeight: "700",
      letterSpacing: -0.5,
    },
    h3: {
      fontFamily: "DMSans-Medium",
      fontSize: 20,
      fontWeight: "500", // Medium
      marginBottom: 8,
    },
    body: {
      fontFamily: "DMSans-Regular",
      fontSize: 16,
      lineHeight: 24,
      fontWeight: "400",
    },
    caption: {
      fontFamily: "DMSans-Medium",
      fontSize: 13,
      fontWeight: "500",
      color: palette.slate550,
    },
    button: {
      fontFamily: "DMSans-Medium",
      fontSize: 16,
      fontWeight: "500",
      letterSpacing: 0.5,
    },
  },
};
