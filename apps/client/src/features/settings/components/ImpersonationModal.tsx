import { UserCog } from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { AppText } from "../../../components/AppText";
import { SearchBar } from "../../../components/SearchBar";
import { useTheme } from "../../../context/ThemeContext";
import api from "../../../services/api";
import { AuthService } from "../../auth/services/AuthService";
import { useAuthStore } from "../../../stores/auth.store";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("ImpersonationModal");

/** Libellés FR des rôles (stockés en anglais en base). */
const ROLE_FR: Record<string, string> = {
  LICENSEE: "Licencié",
  CLUB: "Club",
  STAFF: "Staff",
  ADMIN: "Admin",
  GUEST: "Invité",
};
const roleFr = (role: string): string => ROLE_FR[role] ?? role;

interface SearchResult {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  clubName?: string | null;
  license?: { number: string } | null;
}

interface ImpersonationModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Sélecteur de cible d'impersonation (#545, admin). Recherche par email /
 * prénom / nom / licence (GET /users/search) puis « se connecter en tant que ».
 */
export const ImpersonationModal = ({
  visible,
  onClose,
}: ImpersonationModalProps) => {
  const { theme } = useTheme();
  const refreshAuth = useAuthStore((s) => s.refreshAuth);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [starting, setStarting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  // Hauteur du clavier → paddingBottom de la carte (contenu au-dessus du clavier
  // pendant la saisie).
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

  // Ouvre le clavier automatiquement à l'ouverture (évite un tap). Le délai
  // laisse l'animation de la modale se terminer avant le focus.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [visible]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      api
        .get<SearchResult[]>("/users/search", { params: { q } })
        .then((r) => {
          setResults(r.data);
          // Dès qu'il y a des résultats, on referme le clavier : sinon, sur RN
          // 0.86, le 1er tap sur une ligne ne fait que fermer le clavier (le
          // keyboardShouldPersistTaps n'est pas honoré en modale) → 2 taps.
          // Clavier fermé = le tap sélectionne du premier coup.
          if (r.data.length > 0) Keyboard.dismiss();
        })
        .catch((e) => {
          logger.error("search failed", e);
          setResults([]);
        })
        .finally(() => setSearching(false));
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const startImpersonation = (u: SearchResult) => {
    const name = `${u.firstName} ${u.lastName}`.trim() || u.email;
    setStarting(true);
    AuthService.impersonate(u.id, name)
      .then(() => refreshAuth())
      .then(() => onClose())
      .catch((e) => {
        logger.error("impersonate failed", e);
        Alert.alert(
          "Impossible",
          "L'impersonation a échoué (droits, cible admin, ou backend non à jour).",
        );
      })
      .finally(() => setStarting(false));
  };

  return (
    // Feuille en bas d'écran (bottom-sheet). Pendant la saisie, la carte est
    // remontée au-dessus du clavier (paddingBottom = hauteur du clavier). Dès
    // que des résultats arrivent, on referme le clavier (voir l'effet ci-dessus)
    // → au tap sur une ligne il n'y a plus de clavier à fermer → sélection au
    // 1er tap.
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
          accessibilityRole="button"
          accessibilityLabel="Fermer"
          accessibilityHint="Ferme le sélecteur d'impersonation"
        />
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.surface,
              paddingBottom: keyboardHeight > 0 ? keyboardHeight : 24,
            },
          ]}
        >
          <View style={styles.titleRow}>
            <UserCog size={22} color={theme.primary} />
            <AppText variant="h3" color={theme.text} style={styles.title}>
              Se connecter en tant que
            </AppText>
          </View>
          <AppText variant="caption" color={theme.textSecondary}>
            Recherche par email, nom, prénom ou numéro de licence.
          </AppText>

          <SearchBar
            inputRef={inputRef}
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher un utilisateur…"
            loading={searching}
            containerStyle={styles.searchContainer}
            testID="impersonation-search-input"
          />

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {query.trim().length >= 2 && !searching && results.length === 0 ? (
              <AppText
                variant="caption"
                color={theme.textSecondary}
                align="center"
                style={styles.empty}
              >
                Aucun utilisateur trouvé.
              </AppText>
            ) : (
              results.map((u) => (
                <TouchableOpacity
                  key={u.id}
                  disabled={starting}
                  onPress={() => startImpersonation(u)}
                  accessibilityRole="button"
                  accessibilityLabel={`Se connecter en tant que ${u.firstName} ${u.lastName}`}
                  accessibilityHint={`Rôle ${roleFr(u.role)}`}
                  testID={`impersonation-result-${u.id}`}
                  style={[styles.row, { borderBottomColor: theme.border }]}
                >
                  <View style={styles.rowText}>
                    <AppText variant="body" color={theme.text} weight="600">
                      {u.firstName} {u.lastName}
                    </AppText>
                    <AppText variant="caption" color={theme.textSecondary}>
                      {u.email} · {roleFr(u.role)}
                      {u.license?.number ? ` · ${u.license.number}` : ""}
                    </AppText>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
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
    padding: 20,
    maxHeight: "85%",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1 },
  searchContainer: { paddingHorizontal: 0, marginTop: 14, marginBottom: 4 },
  list: { marginTop: 12, flexShrink: 1 },
  empty: { paddingVertical: 20 },
  row: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { gap: 2 },
});
