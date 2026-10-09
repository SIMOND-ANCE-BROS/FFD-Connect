import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { Eye, EyeOff, Fingerprint } from "lucide-react-native";
import { useRef } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FadeInView } from "../../../components/AnimatedComponents";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { BetaNotice } from "../../../components/BetaNotice";
import { BETA_NOTICES } from "../../../constants/betaNotices";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import { theme } from "../../../theme";
import { useLoginLogic } from "../hooks/useLoginLogic";

type LoginScreenProps = NativeStackScreenProps<RootStackParamList, "Login">;

export const LoginScreen = ({ navigation }: LoginScreenProps) => {
  const { state, actions } = useLoginLogic({ navigation });
  const { theme: currentTheme, isDark } = useTheme();

  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

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
        <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
          <ScrollView
            contentContainerStyle={styles.innerContainer}
            keyboardShouldPersistTaps="handled"
          >
            <FadeInView style={styles.logoContainer} delay={200} duration={600}>
              <Image
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                source={require("../../../assets/logo.png") as number}
                style={styles.logo}
                contentFit="contain"
              />
              <AppText
                variant="h1"
                align="center"
                style={styles.title}
                color={currentTheme.text}
              >
                FFD Connect
              </AppText>
            </FadeInView>

            <BetaNotice
              title={BETA_NOTICES.login.title}
              message={BETA_NOTICES.login.message}
              style={styles.betaNotice}
              testID="login-beta-notice"
            />

            <View style={styles.formContainer}>
              {/* Username Field */}
              <View style={styles.inputGroup}>
                <AppText
                  variant="caption"
                  style={styles.label}
                  color={currentTheme.textSecondary}
                >
                  E-MAIL
                </AppText>
                <Pressable
                  accessible={false}
                  onPress={() => usernameRef.current?.focus()}
                  style={styles.inputPressable}
                >
                  <TextInput
                    ref={usernameRef}
                    testID="login-email-input"
                    accessibilityLabel="login-email-input"
                    accessibilityHint="Saisissez l'e-mail de votre compte FFD-Connect"
                    style={[
                      styles.input,
                      {
                        backgroundColor: isDark
                          ? theme.colors.slate800
                          : theme.colors.slate100,
                        color: currentTheme.text,
                      },
                      state.focusedField === "username"
                        ? styles.inputFocused
                        : styles.inputUnfocused,
                    ]}
                    placeholder="E-mail de votre compte FFD-Connect"
                    placeholderTextColor={
                      isDark ? theme.colors.slate500 : theme.colors.slate400
                    }
                    value={state.username}
                    onChangeText={actions.setUsername}
                    onFocus={() => actions.setFocusedField("username")}
                    onBlur={() => actions.setFocusedField(null)}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    returnKeyType="next"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    blurOnSubmit={false}
                    textContentType="username"
                    autoComplete="username"
                  />
                </Pressable>
              </View>

              {/* Password Field */}
              <View style={styles.inputGroup}>
                <AppText
                  variant="caption"
                  style={styles.label}
                  color={currentTheme.textSecondary}
                >
                  MOT DE PASSE
                </AppText>
                <View
                  style={[
                    styles.passwordContainer,
                    {
                      backgroundColor: isDark
                        ? theme.colors.slate800
                        : theme.colors.slate100,
                    },
                    state.focusedField === "password"
                      ? styles.inputFocused
                      : styles.inputUnfocused,
                  ]}
                >
                  <Pressable
                    accessible={false}
                    onPress={() => passwordRef.current?.focus()}
                    style={styles.passwordPressable}
                  >
                    <TextInput
                      ref={passwordRef}
                      testID="login-password-input"
                      accessibilityLabel="login-password-input"
                      accessibilityHint="Saisissez votre mot de passe"
                      style={[
                        styles.passwordInput,
                        {
                          color: currentTheme.text,
                        },
                      ]}
                      placeholder="Mot de passe de votre compte FFD-Connect"
                      placeholderTextColor={
                        isDark ? theme.colors.slate500 : theme.colors.slate400
                      }
                      value={state.password}
                      onChangeText={actions.setPassword}
                      onFocus={() => actions.setFocusedField("password")}
                      onBlur={() => actions.setFocusedField(null)}
                      secureTextEntry={!state.isPasswordVisible}
                      returnKeyType="done"
                      onSubmitEditing={() => {
                        actions.onLogin().catch(() => {});
                      }}
                      textContentType="password"
                      autoComplete="password"
                    />
                  </Pressable>
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={actions.togglePasswordVisibility}
                    style={styles.eyeIcon}
                    testID="login-password-toggle"
                  >
                    {state.isPasswordVisible ? (
                      <EyeOff size={20} color={currentTheme.textSecondary} />
                    ) : (
                      <Eye size={20} color={currentTheme.textSecondary} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.buttonRow}>
                <AppButton
                  accessibilityLabel="Login Button"
                  accessibilityHint="Valider la connexion"
                  testID="login-submit-button"
                  title={state.loading ? "Connexion..." : "SE CONNECTER"}
                  onPress={() => {
                    actions.onLogin().catch(() => {});
                  }}
                  loading={state.loading}
                  style={styles.loginButton}
                />

                {state.isBiometricAvailable && (
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => {
                      actions.onBiometricLogin().catch(() => {});
                    }}
                    testID="login-biometric-button"
                    style={[
                      styles.biometricButton,
                      { backgroundColor: currentTheme.secondary },
                    ]}
                  >
                    <Fingerprint size={28} color={currentTheme.primary} />
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity
                accessibilityRole="button"
                style={styles.linkButton}
                onPress={actions.onForgotPassword}
                testID="login-forgot-password-button"
              >
                <AppText
                  variant="caption"
                  weight="600"
                  color={currentTheme.primary}
                >
                  Mot de passe oublié ?
                </AppText>
              </TouchableOpacity>

              {/* Beta: an account must be created in the app first (not
                  connected to the federation) — keep this entry prominent. */}
              <AppButton
                variant="outline"
                title="CRÉER UN COMPTE"
                accessibilityLabel="Créer un compte"
                accessibilityHint="Ouvre l'inscription avec votre numéro de licence"
                onPress={() => navigation.navigate("Register")}
                testID="login-register-link"
                style={styles.registerButton}
              />

              <View style={styles.dividerContainer}>
                <View
                  style={[
                    styles.dividerLine,
                    { backgroundColor: currentTheme.border },
                  ]}
                />
                <AppText
                  variant="caption"
                  style={[
                    styles.dividerText,
                    { color: currentTheme.textSecondary },
                  ]}
                >
                  OU
                </AppText>
                <View
                  style={[
                    styles.dividerLine,
                    { backgroundColor: currentTheme.border },
                  ]}
                />
              </View>

              <TouchableOpacity
                onPress={() => {
                  actions.onGuestLogin().catch(() => {});
                }}
                style={styles.guestButton}
                testID="login-guest-button"
                accessibilityLabel="Login as Guest"
                accessibilityHint="Naviguer sans être connecté"
              >
                <AppText
                  variant="button"
                  style={[
                    styles.guestButtonText,
                    { color: currentTheme.textSecondary },
                  ]}
                >
                  Continuer en tant qu'invité
                </AppText>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>
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
  innerContainer: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.l,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: theme.spacing.l,
  },
  betaNotice: {
    marginBottom: theme.spacing.l,
  },
  registerButton: {
    marginTop: theme.spacing.s,
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: theme.spacing.m,
  },
  formContainer: {
    width: "100%",
  },
  inputGroup: {
    marginBottom: theme.spacing.l,
  },
  inputPressable: {
    width: "100%",
  },
  label: {
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontSize: 11,
    fontWeight: "600",
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: "DMSans-Regular",
    borderWidth: 2,
    height: 56, // Fixed height for consistency
  },
  inputFocused: {
    borderColor: theme.colors.ffdCyan,
  },
  inputUnfocused: {
    borderColor: "transparent",
  },
  title: {
    marginBottom: 4,
  },
  passwordInput: {
    flex: 1,
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    fontSize: 16,
    fontFamily: "DMSans-Regular",
    height: "100%",
  },
  passwordPressable: {
    flex: 1,
    height: "100%",
    justifyContent: "center",
  },
  loginButton: {
    flex: 1,
    marginTop: 0,
  },
  linkButton: {
    alignItems: "center",
    marginTop: theme.spacing.l,
    padding: 10,
  },
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 0, // Reset vertical padding for fixed height alignment
    borderWidth: 2,
    height: 56, // Fixed height for consistency
  },
  eyeIcon: {
    padding: 8,
    justifyContent: "center",
    alignItems: "center",
    height: "100%",
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: theme.spacing.l,
    gap: 12,
  },
  biometricButton: {
    padding: 12,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    height: 56, // Match main button height
    width: 56, // Square aspect
  },
  dividerContainer: {
    flexDirection: "row",
    alignItems: "center",
    width: "80%",
    marginBottom: 20,
    marginTop: 30,
    alignSelf: "center",
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: 10,
  },
  guestButton: {
    padding: 10,
    alignSelf: "center",
  },
  guestButtonText: {
    textDecorationLine: "underline",
  },
});
