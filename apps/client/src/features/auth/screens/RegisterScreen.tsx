import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Check, Eye, EyeOff } from "lucide-react-native";
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
import { useRegisterLogic } from "../hooks/useRegisterLogic";

type RegisterScreenProps = NativeStackScreenProps<
  RootStackParamList,
  "Register"
>;

export const RegisterScreen = ({ navigation }: RegisterScreenProps) => {
  const { state, actions } = useRegisterLogic({ navigation });
  const { theme: currentTheme, isDark } = useTheme();

  const emailRef = useRef<TextInput>(null);
  const licenseRef = useRef<TextInput>(null);
  const lastNameRef = useRef<TextInput>(null);
  const firstNameRef = useRef<TextInput>(null);
  const parentEmailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

  const inputStyle = (field: string) => [
    styles.input,
    {
      backgroundColor: isDark ? theme.colors.slate800 : theme.colors.slate100,
      color: currentTheme.text,
    },
    state.focusedField === field ? styles.inputFocused : styles.inputUnfocused,
  ];

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: currentTheme.background }]}
    >
      <StatusBar barStyle={currentTheme.statusBarStyle} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <FadeInView
              style={styles.headerContainer}
              delay={200}
              duration={600}
            >
              <AppText
                variant="h1"
                align="center"
                style={styles.title}
                color={currentTheme.text}
                accessibilityRole="header"
              >
                Inscription
              </AppText>
              <AppText
                variant="body"
                color={currentTheme.textSecondary}
                align="center"
              >
                Votre numéro de licence FFD est requis
              </AppText>
            </FadeInView>

            <BetaNotice
              title={BETA_NOTICES.register.title}
              message={BETA_NOTICES.register.message}
              style={styles.betaNotice}
              testID="register-beta-notice"
            />

            <View style={styles.formContainer}>
              {/* License Number */}
              <View style={styles.inputGroup}>
                <AppText
                  variant="caption"
                  style={styles.label}
                  color={currentTheme.textSecondary}
                  // Duplicates the input's accessibilityLabel: hidden from AT.
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                >
                  NUMÉRO DE LICENCE FFD
                </AppText>
                <Pressable
                  accessible={false}
                  onPress={() => licenseRef.current?.focus()}
                  style={styles.inputPressable}
                >
                  <TextInput
                    ref={licenseRef}
                    testID="register-license-input"
                    accessibilityLabel="Numéro de licence"
                    accessibilityHint="Saisissez votre numéro de licence FFD"
                    style={inputStyle("licenseNumber")}
                    placeholder="Ex: FFD-2025-12345"
                    placeholderTextColor={currentTheme.placeholder}
                    value={state.licenseNumber}
                    onChangeText={actions.setLicenseNumber}
                    onFocus={() => actions.setFocusedField("licenseNumber")}
                    onBlur={() => actions.setFocusedField(null)}
                    autoCapitalize="characters"
                    returnKeyType="next"
                    onSubmitEditing={() => lastNameRef.current?.focus()}
                    blurOnSubmit={false}
                  />
                </Pressable>
              </View>

              {/* Parent's e-mail — minors only (#61) */}
              {state.isMinor ? (
                <View style={styles.inputGroup} testID="register-parent-group">
                  <AppText
                    variant="caption"
                    style={styles.label}
                    color={currentTheme.textSecondary}
                  >
                    E-MAIL D'UN PARENT OU REPRÉSENTANT LÉGAL
                  </AppText>
                  <AppText
                    variant="caption"
                    color={currentTheme.textSecondary}
                    style={styles.parentHint}
                  >
                    Votre licence indique que vous êtes mineur(e). Votre
                    représentant légal recevra un lien pour donner son accord ;
                    d'ici là, vous ne pourrez pas déposer de certificat médical.
                  </AppText>
                  <Pressable
                    accessible={false}
                    onPress={() => parentEmailRef.current?.focus()}
                    style={styles.inputPressable}
                  >
                    <TextInput
                      ref={parentEmailRef}
                      testID="register-parent-email-input"
                      accessibilityLabel="E-mail du représentant légal"
                      accessibilityHint="Saisissez l'adresse e-mail d'un parent ou représentant légal"
                      style={inputStyle("parentEmail")}
                      placeholder="parent@exemple.fr"
                      placeholderTextColor={currentTheme.placeholder}
                      value={state.parentEmail}
                      onChangeText={actions.setParentEmail}
                      onFocus={() => actions.setFocusedField("parentEmail")}
                      onBlur={() => actions.setFocusedField(null)}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                      returnKeyType="next"
                      onSubmitEditing={() => lastNameRef.current?.focus()}
                      blurOnSubmit={false}
                    />
                  </Pressable>
                </View>
              ) : null}

              {/* Last Name */}
              <View style={styles.inputGroup}>
                <AppText
                  variant="caption"
                  style={styles.label}
                  color={currentTheme.textSecondary}
                  // Duplicates the input's accessibilityLabel: hidden from AT.
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                >
                  NOM DE FAMILLE
                </AppText>
                <Pressable
                  accessible={false}
                  onPress={() => lastNameRef.current?.focus()}
                  style={styles.inputPressable}
                >
                  <TextInput
                    ref={lastNameRef}
                    testID="register-lastname-input"
                    accessibilityLabel="Nom de famille"
                    accessibilityHint="Saisissez votre nom tel qu'il apparaît sur la licence"
                    style={inputStyle("lastName")}
                    placeholder="Tel qu'il apparaît sur la licence"
                    placeholderTextColor={currentTheme.placeholder}
                    value={state.lastName}
                    onChangeText={actions.setLastName}
                    onFocus={() => actions.setFocusedField("lastName")}
                    onBlur={() => actions.setFocusedField(null)}
                    autoCapitalize="words"
                    returnKeyType="next"
                    onSubmitEditing={() => firstNameRef.current?.focus()}
                    blurOnSubmit={false}
                  />
                </Pressable>
              </View>

              {/* First Name */}
              <View style={styles.inputGroup}>
                <AppText
                  variant="caption"
                  style={styles.label}
                  color={currentTheme.textSecondary}
                  // Duplicates the input's accessibilityLabel: hidden from AT.
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                >
                  PRÉNOM
                </AppText>
                <Pressable
                  accessible={false}
                  onPress={() => firstNameRef.current?.focus()}
                  style={styles.inputPressable}
                >
                  <TextInput
                    ref={firstNameRef}
                    testID="register-firstname-input"
                    accessibilityLabel="Prénom"
                    accessibilityHint="Saisissez votre prénom"
                    style={inputStyle("firstName")}
                    placeholder="Votre prénom"
                    placeholderTextColor={currentTheme.placeholder}
                    value={state.firstName}
                    onChangeText={actions.setFirstName}
                    onFocus={() => actions.setFocusedField("firstName")}
                    onBlur={() => actions.setFocusedField(null)}
                    autoCapitalize="words"
                    returnKeyType="next"
                    onSubmitEditing={() => emailRef.current?.focus()}
                    blurOnSubmit={false}
                  />
                </Pressable>
              </View>

              {/* Email */}
              <View style={styles.inputGroup}>
                <AppText
                  variant="caption"
                  style={styles.label}
                  color={currentTheme.textSecondary}
                  // Duplicates the input's accessibilityLabel: hidden from AT.
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                >
                  ADRESSE EMAIL
                </AppText>
                <Pressable
                  accessible={false}
                  onPress={() => emailRef.current?.focus()}
                  style={styles.inputPressable}
                >
                  <TextInput
                    ref={emailRef}
                    testID="register-email-input"
                    accessibilityLabel="Adresse email"
                    accessibilityHint="Saisissez votre adresse email"
                    style={inputStyle("email")}
                    placeholder="votre@email.com"
                    placeholderTextColor={currentTheme.placeholder}
                    value={state.email}
                    onChangeText={actions.setEmail}
                    onFocus={() => actions.setFocusedField("email")}
                    onBlur={() => actions.setFocusedField(null)}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    returnKeyType="next"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    blurOnSubmit={false}
                    textContentType="emailAddress"
                    autoComplete="email"
                  />
                </Pressable>
              </View>

              {/* Password */}
              <View style={styles.inputGroup}>
                <AppText
                  variant="caption"
                  style={styles.label}
                  color={currentTheme.textSecondary}
                  // Duplicates the input's accessibilityLabel: hidden from AT.
                  accessibilityElementsHidden
                  importantForAccessibility="no"
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
                      testID="register-password-input"
                      accessibilityLabel="Mot de passe"
                      accessibilityHint="Minimum 8 caractères avec majuscule, chiffre et caractère spécial"
                      style={[
                        styles.passwordInput,
                        { color: currentTheme.text },
                      ]}
                      placeholder="Min. 8 car., majuscule, chiffre, spécial"
                      placeholderTextColor={currentTheme.placeholder}
                      value={state.password}
                      onChangeText={actions.setPassword}
                      onFocus={() => actions.setFocusedField("password")}
                      onBlur={() => actions.setFocusedField(null)}
                      secureTextEntry={!state.isPasswordVisible}
                      returnKeyType="next"
                      onSubmitEditing={() =>
                        confirmPasswordRef.current?.focus()
                      }
                      blurOnSubmit={false}
                      textContentType="newPassword"
                      autoComplete="new-password"
                    />
                  </Pressable>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={
                      state.isPasswordVisible
                        ? "Masquer les mots de passe"
                        : "Afficher les mots de passe"
                    }
                    accessibilityHint="Bascule l'affichage des mots de passe en clair"
                    onPress={actions.togglePasswordVisibility}
                    style={styles.eyeIcon}
                    testID="register-password-toggle"
                  >
                    {state.isPasswordVisible ? (
                      <EyeOff size={20} color={currentTheme.textSecondary} />
                    ) : (
                      <Eye size={20} color={currentTheme.textSecondary} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Confirm Password */}
              <View style={styles.inputGroup}>
                <AppText
                  variant="caption"
                  style={styles.label}
                  color={currentTheme.textSecondary}
                  // Duplicates the input's accessibilityLabel: hidden from AT.
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                >
                  CONFIRMER LE MOT DE PASSE
                </AppText>
                <Pressable
                  accessible={false}
                  onPress={() => confirmPasswordRef.current?.focus()}
                  style={styles.inputPressable}
                >
                  <TextInput
                    ref={confirmPasswordRef}
                    testID="register-confirm-password-input"
                    accessibilityLabel="Confirmer le mot de passe"
                    accessibilityHint="Retapez votre mot de passe pour confirmation"
                    style={inputStyle("confirmPassword")}
                    placeholder="Retapez votre mot de passe"
                    placeholderTextColor={currentTheme.placeholder}
                    value={state.confirmPassword}
                    onChangeText={actions.setConfirmPassword}
                    onFocus={() => actions.setFocusedField("confirmPassword")}
                    onBlur={() => actions.setFocusedField(null)}
                    secureTextEntry={!state.isPasswordVisible}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      actions.onRegister().catch(() => {});
                    }}
                    textContentType="newPassword"
                    autoComplete="new-password"
                  />
                </Pressable>
              </View>

              {/* Acceptation des CGU — requise pour créer un compte (#424) */}
              <View style={styles.cguRow}>
                <TouchableOpacity
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: state.cguAccepted }}
                  accessibilityLabel="Accepter les conditions générales d'utilisation"
                  accessibilityHint="Obligatoire pour créer un compte"
                  testID="register-cgu-checkbox"
                  onPress={actions.toggleCguAccepted}
                  // The visual box is 22pt: extend the touch area to 44pt.
                  hitSlop={11}
                  style={[
                    styles.cguCheckbox,
                    {
                      borderColor: state.cguAccepted
                        ? currentTheme.primaryFill
                        : // The border token is ~1.2:1: the unchecked
                          // box must read as a control (3:1).
                          currentTheme.textSecondary,
                      backgroundColor: state.cguAccepted
                        ? currentTheme.primaryFill
                        : "transparent",
                    },
                  ]}
                >
                  {state.cguAccepted ? <Check size={14} color="#fff" /> : null}
                </TouchableOpacity>
                <AppText
                  variant="caption"
                  color={currentTheme.textSecondary}
                  style={styles.cguText}
                >
                  J'accepte les{" "}
                  <AppText
                    variant="caption"
                    color={currentTheme.primary}
                    onPress={() => navigation.navigate("Legal", { doc: "cgu" })}
                    accessibilityRole="link"
                    accessibilityHint="Ouvre les conditions générales d'utilisation"
                    testID="register-cgu-link"
                  >
                    conditions générales d'utilisation
                  </AppText>{" "}
                  et la{" "}
                  <AppText
                    variant="caption"
                    color={currentTheme.primary}
                    onPress={() =>
                      navigation.navigate("Legal", { doc: "privacy" })
                    }
                    accessibilityRole="link"
                    accessibilityHint="Ouvre la politique de confidentialité"
                    testID="register-privacy-link"
                  >
                    politique de confidentialité
                  </AppText>
                </AppText>
              </View>

              <AppButton
                accessibilityLabel="S'inscrire"
                accessibilityHint="Crée votre compte avec les informations saisies"
                testID="register-submit-button"
                title={state.loading ? "Inscription..." : "S'INSCRIRE"}
                onPress={() => {
                  actions.onRegister().catch(() => {});
                }}
                loading={state.loading}
                style={styles.registerButton}
              />

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Déjà un compte ? Se connecter"
                accessibilityHint="Revient à l'écran de connexion"
                style={styles.linkButton}
                onPress={actions.onGoToLogin}
                testID="register-login-link"
              >
                <AppText
                  variant="caption"
                  weight="600"
                  color={currentTheme.primary}
                >
                  Déjà un compte ? Se connecter
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
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  headerContainer: {
    alignItems: "center",
    marginBottom: 24,
  },
  betaNotice: {
    marginBottom: 24,
  },
  title: {
    marginBottom: 8,
  },
  formContainer: {
    width: "100%",
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  parentHint: {
    marginBottom: 8,
    lineHeight: 18,
  },
  inputPressable: {
    width: "100%",
  },
  input: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  inputFocused: {
    borderWidth: 2,
    borderColor: theme.colors.ffdCyan,
  },
  inputUnfocused: {
    borderWidth: 1,
    borderColor: "transparent",
  },
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    height: 48,
  },
  passwordPressable: {
    flex: 1,
  },
  passwordInput: {
    flex: 1,
    height: 48,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  eyeIcon: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  cguRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 4,
    marginBottom: 4,
  },
  cguCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    marginTop: 1,
  },
  cguText: {
    flex: 1,
    lineHeight: 18,
  },
  registerButton: {
    marginTop: 8,
    height: 48,
    borderRadius: 12,
  },
  linkButton: {
    alignItems: "center",
    paddingVertical: 16,
  },
});
