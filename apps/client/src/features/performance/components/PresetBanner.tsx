import { Bookmark } from "lucide-react-native";
import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { AppText } from "../../../components/AppText";
import { radii } from "../../../constants/radii";
import { useTheme } from "../../../context/ThemeContext";

interface PresetBannerProps {
  /** Name of the active preset, null for a custom programme. */
  presetName: string | null;
  /** The live programme differs from the active preset. */
  modified: boolean;
  /** A competition is loading or running: presets cannot be touched. */
  disabled: boolean;
  onOpen: () => void;
  /** Saves the live programme into the active preset. */
  onUpdate: () => void;
}

/** Top of the setup screen: which preset the programme comes from. */
export const PresetBanner: React.FC<PresetBannerProps> = ({
  presetName,
  modified,
  disabled,
  onOpen,
  onUpdate,
}) => {
  const { theme } = useTheme();
  const opacity = disabled ? 0.4 : 1;
  return (
    <View
      testID="performance-preset-banner"
      style={[
        styles.banner,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={styles.text}>
        <AppText
          variant="body"
          weight="600"
          color={theme.text}
          numberOfLines={1}
          testID="performance-preset-banner-title"
        >
          {presetName ? `Preset : ${presetName}` : "Programme personnalisé"}
        </AppText>
        {modified && (
          <AppText
            variant="caption"
            color={theme.primary}
            testID="performance-preset-modified"
          >
            modifié
          </AppText>
        )}
      </View>
      {modified && presetName && (
        <TouchableOpacity
          onPress={onUpdate}
          disabled={disabled}
          testID="performance-preset-update"
          accessibilityRole="button"
          accessibilityLabel={`Mettre à jour le preset ${presetName}`}
          accessibilityHint="Enregistre le programme actuel dans ce preset"
          accessibilityState={{ disabled }}
          hitSlop={6}
          style={[styles.action, { opacity }]}
        >
          <AppText variant="caption" weight="600" color={theme.primary}>
            Mettre à jour
          </AppText>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        onPress={onOpen}
        disabled={disabled}
        testID="performance-presets-open"
        accessibilityRole="button"
        accessibilityLabel="Presets"
        accessibilityHint="Charge, enregistre ou gère les programmes enregistrés"
        accessibilityState={{ disabled }}
        hitSlop={6}
        style={[styles.action, styles.open, { opacity }]}
      >
        <Bookmark size={16} color={theme.primary} />
        <AppText variant="caption" weight="600" color={theme.primary}>
          Presets
        </AppText>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
  },
  text: { flex: 1, gap: 2 },
  action: { paddingVertical: 4 },
  open: { flexDirection: "row", alignItems: "center", gap: 4 },
});
