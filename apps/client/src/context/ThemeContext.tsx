import React, {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { useColorScheme } from "react-native";
import { useAuthRepository } from "../features/auth/context/AuthContext";
import { theme } from "../theme";

export type ThemePreference = "light" | "dark" | "system";

export interface AppTheme {
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  /** Placeholder text colour for inputs (AA on the input fill). */
  placeholder: string;
  /** Brand colour for text, icons and borders on surface/background. */
  primary: string;
  /**
   * Solid fill of buttons, chips, badges, FABs and selected states that carry
   * `onPrimary` text (WCAG AA in both themes). Tints (`${primary}1A`) and
   * borders keep `primary`.
   */
  primaryFill: string;
  /** Text and icon colour on a `primaryFill` background. */
  onPrimary: string;
  /** Fill of a disabled button (paired with `onDisabled`). */
  disabledFill: string;
  /** Label and icon colour on a `disabledFill` background (≥ 4.5:1). */
  onDisabled: string;
  secondary: string;
  accent: string;
  border: string;
  inputBackground: string;
  statusBarStyle: "dark-content" | "light-content";
  dark: boolean;
  success: string;
  warning: string;
  danger: string;
  /** Semantic colours to use for text on surface/background (WCAG AA). */
  successText: string;
  warningText: string;
  dangerText: string;
  colors: typeof theme.colors;
}

export interface ThemeContextType {
  theme: AppTheme;
  isDark: boolean;
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => Promise<void>;
  animationsEnabled: boolean;
  toggleAnimations: () => Promise<void>;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(
  undefined,
);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [animationsEnabled, setAnimationsEnabledState] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const auth = useAuthRepository();

  useEffect(() => {
    const loadSettings = async () => {
      const config = await auth.getAuthConfig();
      setPreferenceState(config.appTheme ?? "system");
      if (config.animationsEnabled !== undefined) {
        setAnimationsEnabledState(config.animationsEnabled);
      }
      setLoaded(true);
    };
    loadSettings().catch(() => {});
  }, [auth]);

  const setPreference = async (pref: ThemePreference) => {
    setPreferenceState(pref);
    await auth.setAppTheme(pref);
  };

  const toggleAnimations = async () => {
    const newValue = !animationsEnabled;
    setAnimationsEnabledState(newValue);
    await auth.setAnimationsEnabled(newValue);
  };

  // Calculate effective scheme
  const effectiveScheme = preference === "system" ? systemScheme : preference;
  const isDark = effectiveScheme === "dark";
  const currentTheme = isDark ? theme.dark : theme.light;

  // Helper to ensure we have a theme even before async load (default to system/light)
  const activeTheme = loaded ? currentTheme : theme.light;

  // Inject global colors into the current theme
  const themeWithColors: AppTheme = {
    ...activeTheme,
    colors: theme.colors,
  };

  return (
    <ThemeContext.Provider
      value={{
        theme: themeWithColors,
        isDark,
        preference,
        setPreference,
        animationsEnabled,
        toggleAnimations,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
