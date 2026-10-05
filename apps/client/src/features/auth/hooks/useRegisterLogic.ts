import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useState } from "react";
import { Alert } from "react-native";
import { RootStackParamList } from "../../../navigation/types";
import { analytics } from "../../../services/analytics";
import { useAuthStore } from "../../../stores/auth.store";
import { createLogger } from "../../../utils/logger";
import { acceptCgu } from "../../legal/cguConsent";
import { useAuthRepository } from "../context/AuthContext";

const logger = createLogger("useRegisterLogic");

type RegisterScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "Register"
>;

interface UseRegisterLogicProps {
  navigation: RegisterScreenNavigationProp;
}

export const useRegisterLogic = ({ navigation }: UseRegisterLogicProps) => {
  const auth = useAuthRepository();
  const refreshAuth = useAuthStore((s) => s.refreshAuth);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");

  const [loading, setLoading] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [cguAccepted, setCguAccepted] = useState(false);

  const handleRegister = async () => {
    if (
      !email.trim() ||
      !password ||
      !licenseNumber.trim() ||
      !lastName.trim() ||
      !firstName.trim()
    ) {
      Alert.alert("Erreur", "Tous les champs sont obligatoires");
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert("Erreur", "Les mots de passe ne correspondent pas");
      return;
    }

    if (password.length < 8) {
      Alert.alert(
        "Erreur",
        "Le mot de passe doit contenir au moins 8 caractères",
      );
      return;
    }

    if (!cguAccepted) {
      Alert.alert(
        "Conditions d'utilisation",
        "Vous devez accepter les conditions générales d'utilisation pour créer un compte.",
      );
      return;
    }

    setLoading(true);
    try {
      await auth.register(
        email.trim(),
        password,
        licenseNumber.trim(),
        lastName.trim(),
        firstName.trim(),
      );
      analytics.logEvent("register", {});
      // La case CGU cochée vaut acceptation → la modale premier lancement
      // ne réapparaîtra pas après l'inscription (#424).
      await acceptCgu();
      await refreshAuth();
    } catch (e) {
      const error = e as Error;
      logger.error("Registration failed", error);
      Alert.alert("Inscription impossible", error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoToLogin = () => {
    navigation.navigate("Login");
  };

  return {
    state: {
      email,
      password,
      confirmPassword,
      licenseNumber,
      lastName,
      firstName,
      loading,
      isPasswordVisible,
      focusedField,
      cguAccepted,
    },
    actions: {
      setEmail,
      setPassword,
      setConfirmPassword,
      setLicenseNumber,
      setLastName,
      setFirstName,
      togglePasswordVisibility: () => setIsPasswordVisible((prev) => !prev),
      setFocusedField,
      toggleCguAccepted: () => setCguAccepted((prev) => !prev),
      onRegister: handleRegister,
      onGoToLogin: handleGoToLogin,
    },
  };
};
