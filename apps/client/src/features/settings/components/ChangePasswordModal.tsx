import { Eye, EyeOff, Lock } from "lucide-react-native";
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
import { AuthService } from "../../auth/services/AuthService";

interface ChangePasswordModalProps {
  visible: boolean;
  onClose: () => void;
}

export const ChangePasswordModal = ({
  visible,
  onClose,
}: ChangePasswordModalProps) => {
  const { theme: currentTheme } = useTheme();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const resetForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const validatePassword = (password: string): string[] => {
    const errors: string[] = [];

    if (password.length < 8) {
      errors.push("Au moins 8 caractères");
    }
    if (!/[A-Z]/.test(password)) {
      errors.push("Au moins une majuscule");
    }
    if (!/[a-z]/.test(password)) {
      errors.push("Au moins une minuscule");
    }
    if (!/[0-9]/.test(password)) {
      errors.push("Au moins un chiffre");
    }
    if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) {
      errors.push("Au moins un caractère spécial (!@#$%^&*()_+-=[]{}|;:,.<>?)");
    }

    return errors;
  };

  const handleSubmit = async () => {
    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert("Erreur", "Veuillez remplir tous les champs.");
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert("Erreur", "Les nouveaux mots de passe ne correspondent pas.");
      return;
    }

    if (currentPassword === newPassword) {
      Alert.alert(
        "Erreur",
        "Le nouveau mot de passe doit être différent de l'ancien.",
      );
      return;
    }

    const passwordErrors = validatePassword(newPassword);
    if (passwordErrors.length > 0) {
      Alert.alert(
        "Mot de passe invalide",
        `Le mot de passe doit contenir :\n${passwordErrors.join("\n")}`,
      );
      return;
    }

    setLoading(true);
    try {
      await AuthService.changePassword(currentPassword, newPassword);
      Alert.alert("Succès", "Votre mot de passe a été modifié avec succès.", [
        {
          text: "OK",
          onPress: handleClose,
        },
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Une erreur est survenue.";
      Alert.alert("Erreur", message);
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
        accessibilityRole="button"
        style={styles.overlay}
        onPress={handleClose}
      >
        <Pressable
          accessibilityRole="button"
          style={[styles.modal, { backgroundColor: currentTheme.surface }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.header}>
            <AppText variant="h2" color={currentTheme.text}>
              Changer le mot de passe
            </AppText>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={handleClose}
              style={styles.closeButton}
            >
              <Text
                style={[
                  styles.closeButtonText,
                  { color: currentTheme.textSecondary },
                ]}
              >
                ✕
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.content}>
            <Text
              style={[styles.policyText, { color: currentTheme.textSecondary }]}
            >
              Le mot de passe doit contenir :
            </Text>
            <View style={styles.policyList}>
              <Text
                style={[
                  styles.policyItem,
                  { color: currentTheme.textSecondary },
                ]}
              >
                • Au moins 8 caractères
              </Text>
              <Text
                style={[
                  styles.policyItem,
                  { color: currentTheme.textSecondary },
                ]}
              >
                • Au moins une majuscule
              </Text>
              <Text
                style={[
                  styles.policyItem,
                  { color: currentTheme.textSecondary },
                ]}
              >
                • Au moins une minuscule
              </Text>
              <Text
                style={[
                  styles.policyItem,
                  { color: currentTheme.textSecondary },
                ]}
              >
                • Au moins un chiffre
              </Text>
              <Text
                style={[
                  styles.policyItem,
                  { color: currentTheme.textSecondary },
                ]}
              >
                • Au moins un caractère spécial
              </Text>
            </View>

            {/* Current Password */}
            <View style={styles.inputContainer}>
              <View
                style={[
                  styles.inputWrapper,
                  { borderColor: currentTheme.border },
                ]}
              >
                <Lock
                  size={20}
                  color={currentTheme.textSecondary}
                  style={styles.icon}
                />
                <TextInput
                  accessibilityLabel="Mot de passe actuel"
                  accessibilityHint="Saisissez votre mot de passe actuel"
                  style={[styles.input, { color: currentTheme.text }]}
                  placeholder="Mot de passe actuel"
                  placeholderTextColor={currentTheme.textSecondary}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  secureTextEntry={!showCurrentPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setShowCurrentPassword(!showCurrentPassword)}
                  style={styles.eyeButton}
                >
                  {showCurrentPassword ? (
                    <EyeOff size={20} color={currentTheme.textSecondary} />
                  ) : (
                    <Eye size={20} color={currentTheme.textSecondary} />
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* New Password */}
            <View style={styles.inputContainer}>
              <View
                style={[
                  styles.inputWrapper,
                  { borderColor: currentTheme.border },
                ]}
              >
                <Lock
                  size={20}
                  color={currentTheme.textSecondary}
                  style={styles.icon}
                />
                <TextInput
                  accessibilityLabel="Nouveau mot de passe"
                  accessibilityHint="Saisissez votre nouveau mot de passe"
                  style={[styles.input, { color: currentTheme.text }]}
                  placeholder="Nouveau mot de passe"
                  placeholderTextColor={currentTheme.textSecondary}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry={!showNewPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setShowNewPassword(!showNewPassword)}
                  style={styles.eyeButton}
                >
                  {showNewPassword ? (
                    <EyeOff size={20} color={currentTheme.textSecondary} />
                  ) : (
                    <Eye size={20} color={currentTheme.textSecondary} />
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Confirm Password */}
            <View style={styles.inputContainer}>
              <View
                style={[
                  styles.inputWrapper,
                  { borderColor: currentTheme.border },
                ]}
              >
                <Lock
                  size={20}
                  color={currentTheme.textSecondary}
                  style={styles.icon}
                />
                <TextInput
                  accessibilityLabel="Confirmation"
                  accessibilityHint="Confirmez votre nouveau mot de passe"
                  style={[styles.input, { color: currentTheme.text }]}
                  placeholder="Confirmer le nouveau mot de passe"
                  placeholderTextColor={currentTheme.textSecondary}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={styles.eyeButton}
                >
                  {showConfirmPassword ? (
                    <EyeOff size={20} color={currentTheme.textSecondary} />
                  ) : (
                    <Eye size={20} color={currentTheme.textSecondary} />
                  )}
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.buttonContainer}>
              <AppButton
                title="Changer le mot de passe"
                onPress={() => {
                  handleSubmit().catch(() => {});
                }}
                loading={loading}
                style={styles.submitButton}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modal: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 16,
    padding: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  closeButton: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  closeButtonText: {
    fontSize: 24,
    fontWeight: "300",
  },
  content: {
    gap: 16,
  },
  policyText: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  policyList: {
    marginBottom: 8,
  },
  policyItem: {
    fontSize: 12,
    marginBottom: 4,
  },
  inputContainer: {
    marginBottom: 4,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 12,
  },
  icon: {
    marginRight: 4,
  },
  input: {
    flex: 1,
    fontSize: 16,
  },
  eyeButton: {
    padding: 4,
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  submitButton: {
    flex: 1,
  },
});
