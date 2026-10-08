import { UserCog, X } from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Modal,
  Platform,
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

/** Debounce between the last keystroke and the network search. */
export const IMPERSONATION_SEARCH_DEBOUNCE_MS = 350;

// keyboardWill* only fires on iOS; Android only emits keyboardDid*.
const KEYBOARD_SHOW =
  Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
const KEYBOARD_HIDE =
  Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

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
  // Monotonic id of the latest search: a slow response for an older query
  // must never overwrite the results of the current one.
  const requestIdRef = useRef(0);
  const inputRef = useRef<TextInput | null>(null);
  // Hauteur du clavier → paddingBottom de la carte (contenu au-dessus du clavier
  // pendant la saisie).
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!visible) return undefined;
    const show = Keyboard.addListener(KEYBOARD_SHOW, (e) =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(KEYBOARD_HIDE, () =>
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
      requestIdRef.current += 1; // drop any in-flight response
      setResults([]);
      setSearching(false);
      return;
    }
    // The keyboard is deliberately left open while results arrive: closing it
    // here (previous workaround for the "two taps to select" bug) kicked the
    // user out of the field mid-typing. The real cause of the double tap was
    // the parent ScrollView capturing touches (see SettingsScreen); rows now
    // select on the first tap with keyboardShouldPersistTaps="handled".
    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      setSearching(true);
      api
        .get<SearchResult[]>("/users/search", { params: { q } })
        .then((r) => {
          if (requestId === requestIdRef.current) setResults(r.data);
        })
        .catch((e) => {
          logger.error("search failed", e);
          if (requestId === requestIdRef.current) setResults([]);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setSearching(false);
        });
    }, IMPERSONATION_SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // One tap closes the sheet, keyboard included (no "dismiss keyboard first,
  // then tap again"). The search is reset so a reopening starts clean.
  const close = useCallback(() => {
    Keyboard.dismiss();
    requestIdRef.current += 1;
    setQuery("");
    setResults([]);
    setSearching(false);
    onClose();
  }, [onClose]);

  const startImpersonation = (u: SearchResult) => {
    Keyboard.dismiss();
    const name = `${u.firstName} ${u.lastName}`.trim() || u.email;
    setStarting(true);
    AuthService.impersonate(u.id, name)
      .then(() => refreshAuth())
      .then(() => close())
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
    // remontée au-dessus du clavier (paddingBottom = hauteur du clavier).
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          testID="impersonation-backdrop"
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
            <TouchableOpacity
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              accessibilityHint="Ferme le sélecteur d'impersonation"
              testID="impersonation-close"
              hitSlop={10}
            >
              <X size={22} color={theme.textSecondary} />
            </TouchableOpacity>
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

          <ScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            testID="impersonation-results"
          >
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
