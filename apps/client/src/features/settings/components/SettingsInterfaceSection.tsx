import { Moon, Zap } from "lucide-react-native";
import React from "react";
import { Switch, View } from "react-native";
import { AppText } from "../../../components/AppText";
import { FluidSegmentedTab } from "../../../components/FluidSegmentedTab";
import { AppTheme, ThemePreference } from "../../../context/ThemeContext";
import { styles } from "./settings.styles";

const toThemePreference = (val: string): ThemePreference => {
  if (val === "light" || val === "dark" || val === "system") return val;
  return "system";
};

interface SettingsInterfaceSectionProps {
  theme: AppTheme;
  isDark: boolean;
  preference: ThemePreference;
  handleSetTheme: (pref: ThemePreference) => Promise<void>;
  animationsEnabled: boolean;
  handleToggleAnimations: () => void | Promise<void>;
}

export const SettingsInterfaceSection: React.FC<
  SettingsInterfaceSectionProps
> = ({
  theme,
  isDark,
  preference,
  handleSetTheme,
  animationsEnabled,
  handleToggleAnimations,
}) => (
  <>
    <View style={styles.sectionTitleContainer}>
      <AppText
        variant="caption"
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: theme.textSecondary }]}
      >
        Interface
      </AppText>
    </View>

    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      {/* App Theme Selector */}
      <View style={[styles.row, styles.noPaddingBottom]}>
        <View style={styles.rowLeft}>
          <View
            style={[
              styles.iconBox,
              isDark
                ? styles.interfaceIconBoxDark
                : styles.interfaceIconBoxLight,
            ]}
          >
            <Moon size={18} color={theme.text} />
          </View>
          <AppText
            variant="body"
            style={[styles.rowLabel, { color: theme.text }]}
          >
            Thème de l'application
          </AppText>
        </View>
      </View>

      <View style={styles.tabContainer}>
        <FluidSegmentedTab
          activeValue={preference}
          onChange={(val) => {
            handleSetTheme(toThemePreference(val)).catch(() => {});
          }}
          testID="settings-theme-segmented"
          options={[
            { label: "Auto", value: "system" },
            { label: "Clair", value: "light" },
            { label: "Sombre", value: "dark" },
          ]}
        />
      </View>

      {/* Disable Animations Switch */}
      <View
        style={[styles.row, styles.borderTop, { borderTopColor: theme.border }]}
      >
        <View style={styles.rowLeft}>
          <View style={[styles.iconBox, styles.animationsIconBox]}>
            <Zap size={18} color="#9747FF" />
          </View>
          <AppText
            variant="body"
            style={[styles.rowLabel, { color: theme.text }]}
          >
            Animations
          </AppText>
        </View>
        <Switch
          trackColor={{ false: "#767577", true: theme.primary }}
          thumbColor={animationsEnabled ? "#fff" : "#f4f3f4"}
          ios_backgroundColor="#3e3e3e"
          onValueChange={handleToggleAnimations}
          value={animationsEnabled}
          testID="settings-animations-switch"
          accessibilityLabel="Activer les animations"
          accessibilityHint="Active ou désactive les animations de l'application"
        />
      </View>
    </View>
  </>
);
