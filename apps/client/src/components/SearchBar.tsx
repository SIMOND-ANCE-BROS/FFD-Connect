import { Search, X } from "lucide-react-native";
import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";
import { radii } from "../constants/radii";
import { useTheme } from "../context/ThemeContext";

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Ref sur le TextInput (focus programmatique, ex. modale impersonation). */
  inputRef?: React.RefObject<TextInput | null>;
  /** Affiche un spinner à droite (recherche réseau en cours). */
  loading?: boolean;
  /** Surcharge du conteneur (ex. dans une carte qui a déjà son padding). */
  containerStyle?: ViewStyle;
  testID?: string;
}

/**
 * Barre de recherche unifiée de l'app (Bibliothèque, Carrière, Club, Compét…).
 * Même hauteur (44), rayon (md), icône et placeholder style partout. Un bouton
 * ✕ apparaît pour vider quand il y a du texte.
 */
export const SearchBar = ({
  value,
  onChangeText,
  placeholder = "Rechercher…",
  autoFocus,
  inputRef,
  loading,
  containerStyle,
  testID = "search-bar",
}: SearchBarProps) => {
  const { theme, isDark } = useTheme();
  return (
    <View style={[styles.container, containerStyle]}>
      <View
        style={[
          styles.bar,
          {
            backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#FFFFFF",
            borderColor: theme.border,
            borderWidth: isDark ? 0 : 1,
          },
        ]}
      >
        <Search size={20} color={theme.textSecondary} style={styles.icon} />
        <TextInput
          ref={inputRef}
          style={[styles.input, { color: theme.text }]}
          placeholder={placeholder}
          placeholderTextColor={theme.textSecondary}
          value={value}
          onChangeText={onChangeText}
          autoFocus={autoFocus}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={placeholder}
          accessibilityHint="Filtre la liste au fur et à mesure de la saisie"
          testID={testID}
        />
        {loading ? (
          <ActivityIndicator
            size="small"
            color={theme.primary}
            style={styles.trailing}
          />
        ) : value.length > 0 ? (
          <TouchableOpacity
            onPress={() => onChangeText("")}
            accessibilityRole="button"
            accessibilityLabel="Effacer la recherche"
            accessibilityHint="Vide le champ de recherche"
            testID={`${testID}-clear`}
            hitSlop={8}
          >
            <X size={18} color={theme.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    borderRadius: radii.md,
    paddingHorizontal: 14,
  },
  icon: {
    marginRight: 10,
  },
  trailing: {
    marginLeft: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
});
