import { RotateCcw, X } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { AppText } from "./AppText";
import { radii } from "../constants/radii";
import { useTheme } from "../context/ThemeContext";

interface FilterSheetProps {
  visible: boolean;
  onClose: () => void;
  onReset: () => void;
  title?: string;
  /** Nombre de filtres actifs, affiché dans le libellé Réinitialiser. */
  activeCount?: number;
  children: React.ReactNode;
}

/**
 * Feuille de filtres (bottom-sheet) réutilisable. Les filtres s'appliquent en
 * direct (l'écran garde l'état) ; la feuille propose Réinitialiser + Fermer.
 */
export const FilterSheet = ({
  visible,
  onClose,
  onReset,
  title = "Filtres",
  activeCount = 0,
  children,
}: FilterSheetProps) => {
  const { theme } = useTheme();
  // Hauteur du clavier : la carte reste ancrée en bas (son fond court derrière
  // le clavier, pas de trou), et paddingBottom = hauteur du clavier remonte le
  // contenu (ex. champs MPM) au-dessus du clavier.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    if (!visible) return undefined;
    const show = Keyboard.addListener("keyboardWillShow", (e) =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener("keyboardWillHide", () =>
      setKeyboardHeight(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Fermer les filtres"
        accessibilityHint="Ferme le panneau de filtres"
      >
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: theme.surface,
              paddingBottom: keyboardHeight > 0 ? keyboardHeight : 28,
            },
          ]}
          onPress={() => {}}
          accessibilityRole="none"
        >
          <View style={styles.header}>
            <AppText variant="h3" color={theme.text} style={styles.title}>
              {title}
            </AppText>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              accessibilityHint="Ferme le panneau de filtres"
              hitSlop={8}
            >
              <X size={22} color={theme.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>

          <TouchableOpacity
            onPress={onReset}
            disabled={activeCount === 0}
            accessibilityRole="button"
            accessibilityLabel="Réinitialiser les filtres"
            accessibilityHint="Efface tous les filtres actifs"
            testID="filter-reset"
            style={[
              styles.resetButton,
              {
                borderColor: theme.border,
                opacity: activeCount === 0 ? 0.4 : 1,
              },
            ]}
          >
            <RotateCcw size={18} color={theme.text} />
            <AppText variant="button" color={theme.text}>
              Réinitialiser{activeCount > 0 ? ` (${activeCount})` : ""}
            </AppText>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  card: {
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: 20,
    paddingTop: 16,
    // paddingBottom est dynamique (= hauteur du clavier) — voir le JSX.
    maxHeight: "92%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: { flex: 1 },
  body: { flexShrink: 1 },
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 12,
    marginTop: 16,
  },
});
