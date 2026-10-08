import { Check } from "lucide-react-native";
import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import type { SpaceRole } from "./spaces";
import { SPACE_LABELS } from "./spaces";

interface SpaceSheetProps {
  visible: boolean;
  choices: SpaceRole[];
  current: SpaceRole | null;
  onSelect: (space: SpaceRole) => void;
  onClose: () => void;
}

/** Bottom sheet listing the spaces the account can switch to. */
export const SpaceSheet = ({
  visible,
  choices,
  current,
  onSelect,
  onClose,
}: SpaceSheetProps) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          testID="settings-space-backdrop"
          accessibilityRole="button"
          accessibilityLabel="Fermer"
          accessibilityHint="Ferme le sélecteur d'espace"
        />
        <View
          testID="settings-space-sheet"
          style={[
            styles.card,
            {
              backgroundColor: theme.surface,
              paddingBottom: Math.max(insets.bottom, 16) + 16,
            },
          ]}
        >
          <AppText
            variant="h3"
            color={theme.text}
            accessibilityRole="header"
            style={styles.title}
          >
            Changer d'espace
          </AppText>
          {choices.map((r, index) => {
            const selected = r === current;
            return (
              <TouchableOpacity
                key={r}
                accessibilityRole="radio"
                accessibilityLabel={SPACE_LABELS[r]}
                accessibilityHint={
                  selected
                    ? "Espace actuel"
                    : "Change l'espace actif de l'application"
                }
                accessibilityState={{ checked: selected }}
                testID={`settings-space-${r}`}
                onPress={() => onSelect(r)}
                style={[
                  styles.row,
                  index > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.border,
                  },
                ]}
              >
                <AppText
                  variant="body"
                  color={theme.text}
                  weight={selected ? "600" : "normal"}
                  style={styles.rowLabel}
                >
                  {SPACE_LABELS[r]}
                </AppText>
                <View
                  style={[
                    styles.radio,
                    {
                      borderColor: selected ? theme.primary : theme.border,
                      backgroundColor: selected ? theme.primary : "transparent",
                    },
                  ]}
                >
                  {selected && <Check size={14} color="#fff" />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  card: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  title: { marginBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
  },
  rowLabel: { flex: 1, marginBottom: 0 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
  },
});
