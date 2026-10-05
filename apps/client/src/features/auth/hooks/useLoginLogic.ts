import * as Sentry from "@sentry/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { ERROR_MESSAGES } from "../../../constants/errorMessages";
import { RootStackParamList } from "../../../navigation/types";
import { analytics } from "../../../services/analytics";
import { useAuthStore } from "../../../stores/auth.store";
import rnBiometrics, { BiometryTypes } from "../../../utils/biometrics-adapter";
import { validateForm } from "../../../utils/formValidation";
import { createLogger } from "../../../utils/logger";
import { useAuthRepository } from "../context/AuthContext";
import { loginSchema } from "../schemas/login.schema";

const logger = createLogger("useLoginLogic");

// One-time key: whether we've already offered to enable biometric login.
const BIOMETRIC_PROMPT_SHOWN_KEY = "ffd.biometricPromptShown";

type LoginScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "Login"
>;

interface UseLoginLogicProps {
  navigation: LoginScreenNavigationProp;
}

export const useLoginLogic = ({ navigation }: UseLoginLogicProps) => {
  const auth = useAuthRepository();
  const refreshAuth = useAuthStore((s) => s.refreshAuth);

  // Form State
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const formValuesRef = useRef({ username: "", password: "" });
  formValuesRef.current = { username, password };

  // UI State
  const [loading, setLoading] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [focusedField, setFocusedField] = useState<
    "username" | "password" | null
  >(null);
  const [isBiometricAvailable, setIsBiometricAvailable] = useState(false);

  // Checks for biometric availability on mount
  useEffect(() => {
    let mounted = true;

    const checkBiometrics = async () => {
      try {
        const config = await auth.getAuthConfig();
        const { available } = await rnBiometrics.isSensorAvailable();

        if (mounted) {
          // Enable button only if hardware available AND user enabled it
          setIsBiometricAvailable(available && !!config.biometricsEnabled);

          // Auto-login logic
          if (config.isLoggedIn && config.biometricsEnabled && available) {
            handleBiometricLogin().catch(() => {});
          }
        }
      } catch (error) {
        logger.error("Failed to check biometrics", error);
      }
    };

    checkBiometrics().catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  const handleBiometricLogin = async () => {
    const config = await auth.getAuthConfig();
    const { available } = await rnBiometrics.isSensorAvailable();

    if (!available || !config.biometricsEnabled) {
      Alert.alert(
        "Non disponible",
        "La connexion biométrique n'est pas activée.",
      );
      return;
    }

    try {
      const result = await rnBiometrics.simplePrompt({
        promptMessage: "Connexion à FFD Connect",
      });

      if (result.success) {
        setLoading(true);
        logger.info("Biometric auth successful, restoring session...");

        try {
          // 1. Fetch fresh profile to verify token is still valid
          const profile = await auth.getProfile();

          // 2. Restore full session config
          const newConfig = {
            ...config,
            isLoggedIn: true,
            username: profile.email,
            role: profile.role,
            clubName: profile.clubName,
            lastLoginDate: new Date().toISOString(),
          };

          await auth.saveAuthConfig(newConfig);
          Sentry.setUser({
            username: profile.email,
            data: { role: profile.role },
          });
          logger.info("Session restored", { role: profile.role });
          analytics.logEvent("login_biometric", { method: "biometric" });

          await refreshAuth();
        } catch (err) {
          logger.error("Session restore failed", err);
          Alert.alert(
            "Session expirée",
            "Votre session a expiré. Veuillez vous reconnecter avec votre mot de passe.",
          );
          Sentry.setUser(null);
          await auth.logout(); // Clean up stale token
        } finally {
          setLoading(false);
        }
      }
    } catch (error) {
      logger.error("Biometric prompt failed", error);
      // User cancelled or hardware error, silent fail
    }
  };

  // After the first successful login, offer to enable biometric login once
  // (opt-in). "Activer" triggers the iOS Face ID permission prompt; either
  // choice marks the offer as shown so we never nag again.
  const offerBiometricEnrollment = async () => {
    try {
      const shown = await AsyncStorage.getItem(BIOMETRIC_PROMPT_SHOWN_KEY);
      if (shown) return;
      const config = await auth.getAuthConfig();
      if (config.biometricsEnabled) return;
      const { available, biometryType } =
        await rnBiometrics.isSensorAvailable();
      if (!available) return;

      const label =
        biometryType === BiometryTypes.FaceID ? "Face ID" : "la biométrie";
      Alert.alert(
        `Activer ${label} ?`,
        `Utilisez ${label} pour sécuriser et accélérer l'accès à FFD Connect.`,
        [
          {
            text: "Plus tard",
            style: "cancel",
            onPress: () => {
              void AsyncStorage.setItem(BIOMETRIC_PROMPT_SHOWN_KEY, "1");
            },
          },
          {
            text: "Activer",
            onPress: () => {
              void (async () => {
                await AsyncStorage.setItem(BIOMETRIC_PROMPT_SHOWN_KEY, "1");
                const { success } = await rnBiometrics.simplePrompt({
                  promptMessage: `Activer ${label}`,
                });
                if (success) {
                  await auth.setBiometricsEnabled(true);
                  logger.info("Biometric login enabled from first-login offer");
                }
              })().catch((e) => logger.error("Enroll biometrics failed", e));
            },
          },
        ],
      );
    } catch (e) {
      logger.error("offerBiometricEnrollment failed", e);
    }
  };

  const handleLogin = async () => {
    const { username: u, password: p } = formValuesRef.current;
    // Validation avec Zod
    try {
      const validation = validateForm(loginSchema, {
        username: u,
        password: p,
      });

      if (!validation.success) {
        const errors = validation.errors ?? {};
        const firstError = Object.values(errors)[0];
        Alert.alert(
          "Erreur de validation",
          firstError || ERROR_MESSAGES.LOGIN_REQUIRED,
        );
        return;
      }
    } catch (error) {
      logger.error("Validation crashed", error);
      Alert.alert("Erreur", "Une erreur est survenue");
      return;
    }

    setLoading(true);
    try {
      logger.info("Attempting login", { username: u });
      await auth.login(u, p);
      const config = await auth.getAuthConfig();
      Sentry.setUser({ username: u, data: { role: config.role } });
      logger.info("Login success", { role: config.role });
      analytics.logEvent("login", { method: "email" });

      setLoading(false);
      // Offer biometric login once (non-blocking — the Alert shows over the
      // next screen after refreshAuth navigates).
      void offerBiometricEnrollment();
      await refreshAuth();
    } catch (e) {
      const error = e as Error;
      logger.error("Login failed", error);
      setLoading(false);
      Alert.alert("Échec", error.message || ERROR_MESSAGES.LOGIN_FAILED);
    }
  };

  const handleGuestLogin = async () => {
    setLoading(true);
    try {
      await auth.loginAsGuest();
      analytics.logEvent("login_guest", { method: "guest" });
      await refreshAuth();
    } catch (error) {
      logger.error("Guest login failed", error);
      Alert.alert("Erreur", "Impossible de se connecter en tant qu'invité");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    navigation.navigate("ForgotPassword");
  };

  return {
    state: {
      username,
      password,
      loading,
      isPasswordVisible,
      focusedField,
      isBiometricAvailable,
    },
    actions: {
      setUsername,
      setPassword,
      togglePasswordVisibility: () => setIsPasswordVisible((prev) => !prev),
      setFocusedField,
      onLogin: handleLogin,
      onBiometricLogin: handleBiometricLogin,
      onGuestLogin: handleGuestLogin,
      onForgotPassword: handleForgotPassword,
    },
  };
};
