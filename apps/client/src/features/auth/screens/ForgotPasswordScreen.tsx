import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Mail } from "lucide-react-native";
import React, { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { BackButton } from "../../../components/BackButton";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import { AuthService } from "../services/AuthService";

type ForgotPasswordScreenProps = NativeStackScreenProps<
  RootStackParamList,
  "ForgotPassword"
>;

export const ForgotPasswordScreen = ({
  navigation,
}: ForgotPasswordScreenProps) => {
  const { theme: currentTheme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(insets.top + 56);
  const [loading, setLoading] = useState(false);
  const emailRef = React.useRef("");

  const handleSubmit = React.useCallback(async () => {
    // Get email from ref
    const emailValue = emailRef.current || "";
    const trimmedEmail = emailValue.trim();

    if (!trimmedEmail) {
      Alert.alert("Erreur", "Veuillez entrer votre adresse email.");
      return;
    }

    // Validation basique de l'email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isValid = emailRegex.test(trimmedEmail);

    if (!isValid) {
      Alert.alert("Erreur", "Veuillez entrer une adresse email valide.");
      return;
    }

    setLoading(true);
    try {
      await AuthService.forgotPassword(trimmedEmail);
      Alert.alert(
        "Email envoyé",
        "Si cette adresse email existe dans notre système, vous recevrez un email avec les instructions pour réinitialiser votre mot de passe.",
        [
          {
            text: "OK",
            onPress: () => navigation.goBack(),
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
  }, [navigation]);

  const inputBgColor = isDark
    ? "rgba(255, 255, 255, 0.05)"
    : "rgba(0, 0, 0, 0.05)";

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: currentTheme.background }]}
      edges={["left", "right"]}
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
          contentContainerStyle={{
            ...styles.scrollContent,
            paddingTop: headerH,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Content */}
          <View style={styles.content}>
            <View style={styles.iconContainer}>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: `${currentTheme.primary}20` },
                ]}
              >
                <Mail size={48} color={currentTheme.primary} />
              </View>
            </View>

            <AppText
              variant="body"
              color={currentTheme.text}
              style={styles.description}
            >
              Entrez votre adresse email et nous vous enverrons un lien pour
              réinitialiser votre mot de passe.
            </AppText>

            {/* Email Input */}
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
                <Mail size={20} color={currentTheme.textSecondary} />
                <TextInput
                  accessibilityLabel="Email"
                  accessibilityHint="Saisissez votre adresse email pour réinitialiser le mot de passe"
                  testID="forgot-password-email-input"
                  style={[styles.input, { color: currentTheme.text }]}
                  placeholder="Votre adresse email"
                  placeholderTextColor={currentTheme.textSecondary}
                  onChangeText={(text) => {
                    emailRef.current = text;
                  }}
                  onSubmitEditing={() => {
                    handleSubmit().catch(() => {});
                  }}
                  returnKeyType="send"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                />
              </View>
            </View>

            <AppButton
              testID="forgot-password-submit"
              title={loading ? "Envoi en cours..." : "Envoyer"}
              onPress={() => {
                handleSubmit().catch(() => {});
              }}
              loading={loading}
              style={styles.submitButton}
            />

            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => navigation.goBack()}
              style={styles.backLink}
            >
              <AppText variant="caption" color={currentTheme.primary}>
                Retour à la connexion
              </AppText>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <PinnedHeader
        theme={currentTheme}
        isDark={isDark}
        title="Mot de passe oublié"
        onHeightChange={setHeaderH}
        left={<BackButton onPress={() => navigation.goBack()} />}
      />
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
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 32,
    gap: 16,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
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
    marginBottom: 32,
    lineHeight: 22,
  },
  inputContainer: {
    marginBottom: 24,
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
  submitButton: {
    marginBottom: 16,
  },
  backLink: {
    alignItems: "center",
    padding: 12,
  },
});
