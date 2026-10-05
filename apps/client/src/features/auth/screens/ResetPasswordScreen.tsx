import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Eye, EyeOff, Lock } from "lucide-react-native";
import React, { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import { AuthService } from "../services/AuthService";

type ResetPasswordScreenProps = NativeStackScreenProps<
  RootStackParamList,
  "ResetPassword"
>;

export const ResetPasswordScreen = ({
  navigation,
  route,
}: ResetPasswordScreenProps) => {
  const { theme: currentTheme, isDark } = useTheme();
  const token = route.params?.token ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);

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
    if (!/[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password)) {
      errors.push("Au moins un caractère spécial (!@#$%^&*()_+-=[]{}|;:,.<>?)");
    }

    return errors;
  };

  const handleSubmit = async () => {
    if (!token) {
      Alert.alert("Erreur", "Token de réinitialisation manquant.");
      navigation.navigate("Login");
      return;
    }

    if (!newPassword || !confirmPassword) {
      Alert.alert("Erreur", "Veuillez remplir tous les champs.");
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert("Erreur", "Les mots de passe ne correspondent pas.");
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
      await AuthService.resetPassword(token, newPassword);
      Alert.alert(
        "Succès",
        "Votre mot de passe a été réinitialisé avec succès. Vous pouvez maintenant vous connecter.",
        [
          {
            text: "OK",
            onPress: () => navigation.navigate("Login"),
          },
        ],
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Une erreur est survenue.";
      Alert.alert("Erreur", message);
    } finally {
      setLoading(false);
    }
  };

  const inputBgColor = isDark
    ? "rgba(255, 255, 255, 0.05)"
    : "rgba(0, 0, 0, 0.05)";

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: currentTheme.background }]}
    >
      <StatusBar
        barStyle={currentTheme.statusBarStyle}
        backgroundColor={currentTheme.background}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <AppText variant="h1" color={currentTheme.text}>
              Réinitialiser le mot de passe
            </AppText>
          </View>

          {/* Content */}
          <View style={styles.content}>
            <View style={styles.iconContainer}>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: `${currentTheme.primary}20` },
                ]}
              >
                <Lock size={48} color={currentTheme.primary} />
              </View>
            </View>

            <AppText
              variant="body"
              color={currentTheme.text}
              style={styles.description}
            >
              Entrez votre nouveau mot de passe. Assurez-vous qu'il respecte la
              politique de sécurité.
            </AppText>

            {/* Password Policy */}
            <View
              style={[
                styles.policyContainer,
                {
                  backgroundColor: inputBgColor,
                },
              ]}
            >
              <AppText
                variant="caption"
                color={currentTheme.textSecondary}
                style={styles.policyTitle}
              >
                Le mot de passe doit contenir :
              </AppText>
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
            </View>

            {/* New Password Input */}
            <View style={styles.inputContainer}>
              <View
                style={[
                  styles.inputWrapper,
                  {
                    backgroundColor: inputBgColor,
                    borderColor: currentTheme.border,
                  },
                ]}
              >
                <Lock size={20} color={currentTheme.textSecondary} />
                <TextInput
                  accessibilityLabel="Text input field"
                  accessibilityHint="Saisissez le nouveau mot de passe"
                  testID="reset-password-new-input"
                  style={[styles.input, { color: currentTheme.text }]}
                  placeholder="Nouveau mot de passe"
                  placeholderTextColor={currentTheme.textSecondary}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry={!showNewPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password-new"
                  textContentType="newPassword"
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

            {/* Confirm Password Input */}
            <View style={styles.inputContainer}>
              <View
                style={[
                  styles.inputWrapper,
                  {
                    backgroundColor: inputBgColor,
                    borderColor: currentTheme.border,
                  },
                ]}
              >
                <Lock size={20} color={currentTheme.textSecondary} />
                <TextInput
                  accessibilityLabel="Text input field"
                  accessibilityHint="Confirmez le nouveau mot de passe"
                  testID="reset-password-confirm-input"
                  style={[styles.input, { color: currentTheme.text }]}
                  placeholder="Confirmer le nouveau mot de passe"
                  placeholderTextColor={currentTheme.textSecondary}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password-new"
                  textContentType="newPassword"
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

            <AppButton
              testID="reset-password-submit"
              title={loading ? "Réinitialisation..." : "Réinitialiser"}
              onPress={() => {
                handleSubmit().catch(() => {});
              }}
              loading={loading}
              style={styles.submitButton}
            />

            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => navigation.navigate("Login")}
              style={styles.backLink}
            >
              <AppText variant="caption" color={currentTheme.primary}>
                Retour à la connexion
              </AppText>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 20,
  },
  header: {
    marginBottom: 32,
  },
  content: {
    flex: 1,
    justifyContent: "center",
  },
  iconContainer: {
    alignItems: "center",
    marginBottom: 24,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
  },
  description: {
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  policyContainer: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  policyTitle: {
    fontWeight: "600",
    marginBottom: 8,
  },
  policyList: {
    gap: 4,
  },
  policyItem: {
    fontSize: 12,
    marginBottom: 4,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    gap: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
  },
  eyeButton: {
    padding: 4,
  },
  submitButton: {
    marginBottom: 16,
  },
  backLink: {
    alignItems: "center",
    padding: 12,
  },
});
