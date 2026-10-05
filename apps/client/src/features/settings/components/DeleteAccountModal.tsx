import { Eye, EyeOff, TriangleAlert } from "lucide-react-native";
import { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import { deleteMyAccount } from "../services/PrivacyService";

interface DeleteAccountModalProps {
  visible: boolean;
  onClose: () => void;
  /** Appelé après suppression réussie — l'appelant déconnecte l'utilisateur. */
  onDeleted: () => void;
}

/**
 * Confirmation finale de suppression de compte (#424, RGPD art. 17).
 * Le mot de passe courant est exigé par le backend — un téléphone déverrouillé
 * ou un token volé ne suffisent pas à détruire le compte.
 */
export const DeleteAccountModal = ({
  visible,
  onClose,
  onDeleted,
}: DeleteAccountModalProps) => {
  const { theme } = useTheme();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleClose = () => {
    setPassword("");
    setShowPassword(false);
    onClose();
  };

  const handleDelete = async () => {
    if (!password) {
      Alert.alert("Erreur", "Veuillez saisir votre mot de passe.");
      return;
    }
    setLoading(true);
    try {
      await deleteMyAccount(password);
      handleClose();
      onDeleted();
    } catch (e) {
      const wrongPassword =
        e instanceof Error && e.message === "WRONG_PASSWORD";
      Alert.alert(
        "Erreur",
        wrongPassword
          ? "Mot de passe incorrect."
          : "La suppression a échoué. Réessayez plus tard.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <Pressable
        style={styles.backdrop}
        onPress={handleClose}
        accessible={false}
      >
        <Pressable
          style={[styles.card, { backgroundColor: theme.surface }]}
          onPress={() => {}}
          accessible={false}
        >
          <View style={styles.titleRow}>
            <TriangleAlert size={22} color="#e74c3c" />
            <AppText variant="h3" color={theme.text} style={styles.title}>
              Supprimer mon compte
            </AppText>
          </View>

          <AppText
            variant="body"
            color={theme.textSecondary}
            style={styles.warning}
          >
            Cette action est irréversible : profil, inscriptions, partenariats
            et notifications seront définitivement supprimés. Votre licence
            fédérale reste valable auprès de la FFD, elle sera simplement
            détachée de l'application.
          </AppText>

          <AppText variant="body" color={theme.text} style={styles.label}>
            Confirmez avec votre mot de passe :
          </AppText>
          <View
            style={[
              styles.inputRow,
              {
                borderColor: theme.border,
                backgroundColor: theme.background,
              },
            ]}
          >
            <TextInput
              style={[styles.input, { color: theme.text }]}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Mot de passe"
              accessibilityHint="Saisissez votre mot de passe pour confirmer la suppression"
              placeholder="Mot de passe"
              placeholderTextColor={theme.textSecondary}
              testID="delete-account-password-input"
            />
            <TouchableOpacity
              onPress={() => setShowPassword((s) => !s)}
              accessibilityRole="button"
              accessibilityLabel={
                showPassword
                  ? "Masquer le mot de passe"
                  : "Afficher le mot de passe"
              }
              accessibilityHint="Bascule la visibilité du mot de passe saisi"
            >
              {showPassword ? (
                <EyeOff size={20} color={theme.textSecondary} />
              ) : (
                <Eye size={20} color={theme.textSecondary} />
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.buttons}>
            <AppButton
              title="Annuler"
              variant="secondary"
              onPress={handleClose}
              disabled={loading}
              testID="delete-account-cancel-button"
            />
            <View style={styles.buttonSpacer} />
            <AppButton
              title={loading ? "Suppression…" : "Supprimer définitivement"}
              variant="danger"
              onPress={() => {
                handleDelete().catch(() => {});
              }}
              disabled={loading}
              testID="delete-account-confirm-button"
            />
          </View>
          <Text style={[styles.footnote, { color: theme.textSecondary }]}>
            RGPD art. 17 — droit à l'effacement
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    padding: 24,
  },
  card: { borderRadius: 16, padding: 20 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1 },
  warning: { marginTop: 12, lineHeight: 20 },
  label: { marginTop: 16, marginBottom: 8 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  input: { flex: 1, paddingVertical: 10 },
  buttons: { flexDirection: "row", marginTop: 20 },
  buttonSpacer: { width: 12 },
  footnote: { marginTop: 12, fontSize: 11, textAlign: "center" },
});
