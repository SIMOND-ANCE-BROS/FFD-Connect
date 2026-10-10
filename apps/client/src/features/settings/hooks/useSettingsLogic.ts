import { useFocusEffect } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import { Alert, Platform } from "react-native";
import rnBiometrics, { BiometryTypes } from "../../../utils/biometrics-adapter";
import * as Device from "expo-device";
import * as ImagePicker from "expo-image-picker";
import { STATIC_BASE_URL } from "../../../config";
import { ThemePreference, useTheme } from "../../../context/ThemeContext";
import { useBackendHealth } from "../../../hooks/useBackendHealth";
import { RootStackParamList } from "../../../navigation/types";
import { useAuthStore } from "../../../stores/auth.store";
import { getAppIdentity } from "../../../utils/appIdentity";
import { createLogger } from "../../../utils/logger";
import { useAuthRepository } from "../../auth/context/AuthContext";
import { UserRole } from "../../auth/services/AuthService";
import type { HelloAssoStatus } from "../../club/services/ClubService";
import { ClubService } from "../../club/services/ClubService";
import { usage } from "../../../services/analytics/usage";

const logger = createLogger("useSettingsLogic");

interface UseSettingsLogicProps {
  navigation: NativeStackNavigationProp<RootStackParamList, "Settings">;
}

export const useSettingsLogic = ({
  navigation: _navigation,
}: UseSettingsLogicProps) => {
  const auth = useAuthRepository();
  const refreshAuth = useAuthStore((s) => s.refreshAuth);
  const backendHealth = useBackendHealth();
  const {
    theme: currentTheme,
    preference,
    setPreference,
    isDark,
    animationsEnabled,
    toggleAnimations,
  } = useTheme();

  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [biometryType, setBiometryType] = useState<string | undefined>(
    undefined,
  );
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [defaultFilter, setDefaultFilter] = useState<
    "default" | "style" | "likes"
  >("default");
  const [defaultCompetitionScope, setDefaultCompetitionScope] = useState<
    "all" | "registrant"
  >("all");
  const [defaultCompetitionStatus, setDefaultCompetitionStatus] = useState<
    "UPCOMING" | "LIVE" | "PAST" | "ALL"
  >("UPCOMING");
  const [role, setRole] = useState<UserRole>("LICENSEE");
  const [registrationPolicy, setRegistrationPolicy] = useState<
    "CLUB_ONLY" | "MEMBER_VALIDATION" | "MEMBER_AUTO"
  >("MEMBER_VALIDATION");
  const [helloAssoStatus, setHelloAssoStatus] =
    useState<HelloAssoStatus | null>(null);
  const [helloAssoModalVisible, setHelloAssoModalVisible] = useState(false);

  // License expiry warning (days until license expires, null if not applicable)
  const [licenseExpiryDays, setLicenseExpiryDays] = useState<number | null>(
    null,
  );

  /**
   * Store-review account (#212), read from /users/me. null until the profile
   * is known: impersonation stays hidden until then, the API refuses it to
   * that account anyway.
   */
  const [isStoreReview, setIsStoreReview] = useState<boolean | null>(null);
  /** Mesure d'audience anonyme (lot 5) ; null tant que la préférence charge. */
  const [usageEnabled, setUsageEnabled] = useState<boolean | null>(null);

  // UI State
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [changePasswordModalVisible, setChangePasswordModalVisible] =
    useState(false);

  const loadSettings = useCallback(async () => {
    void usage.recorder.isEnabled().then(setUsageEnabled);
    try {
      const config = await auth.getAuthConfig();
      setBiometricsEnabled(config.biometricsEnabled ?? false);
      setPhotoUri(config.licensePhotoUri ?? null);
      setDefaultFilter(config.defaultLibraryFilter ?? "default");
      setDefaultCompetitionScope(config.defaultCompetitionScope ?? "all");
      setDefaultCompetitionStatus(
        config.defaultCompetitionStatus ?? "UPCOMING",
      );
      setRole(config.role);
      if (config.registrationPolicy) {
        setRegistrationPolicy(config.registrationPolicy);
      }
      if (config.role === "CLUB" || config.role === "ADMIN") {
        try {
          const status = await ClubService.getHelloAssoStatus();
          setHelloAssoStatus(status);
          if (status.registrationMode) {
            const map: Record<
              string,
              "CLUB_ONLY" | "MEMBER_VALIDATION" | "MEMBER_AUTO"
            > = {
              CLUB_AND_MEMBERS_PENDING: "MEMBER_VALIDATION",
              CLUB_ONLY: "CLUB_ONLY",
              MEMBERS_AUTO_CONFIRM: "MEMBER_AUTO",
            };
            setRegistrationPolicy(
              map[status.registrationMode] ?? "MEMBER_VALIDATION",
            );
          }
        } catch {
          setHelloAssoStatus(null);
        }
      } else {
        setHelloAssoStatus(null);
      }

      // Check license expiry
      try {
        const profile = await auth.getProfile();
        setIsStoreReview(profile.isStoreReview === true);
        // Same /users/me response, no extra request: picks up a role changed
        // in the back-office without a re-login.
        try {
          const synced = await auth.syncRolesFromProfile(profile);
          setRole(synced.role);
          await refreshAuth();
        } catch (error) {
          logger.warn("[Settings] Role sync failed", error);
        }
        if (profile.license?.validUntil) {
          const now = new Date();
          const expiry = new Date(profile.license.validUntil);
          const diffMs = expiry.getTime() - now.getTime();
          const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          setLicenseExpiryDays(days > 0 && days <= 30 ? days : null);
        } else {
          setLicenseExpiryDays(null);
        }
      } catch {
        setLicenseExpiryDays(null);
      }
    } catch (error) {
      logger.error("[Settings] Error loading settings:", error);
    }
  }, [auth, refreshAuth]);

  const checkBiometryAvailability = useCallback(async () => {
    const { available, biometryType: bioType } =
      await rnBiometrics.isSensorAvailable();
    if (available && bioType) {
      setBiometryType(bioType);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSettings().catch(() => {});
      checkBiometryAvailability().catch(() => {});
    }, [loadSettings, checkBiometryAvailability]),
  );

  const toggleBiometrics = async (value: boolean) => {
    if (value) {
      try {
        const { success } = await rnBiometrics.simplePrompt({
          promptMessage: "Confirmer l'activation",
        });

        if (success) {
          setBiometricsEnabled(true);
          await auth.setBiometricsEnabled(true);
        } else {
          setBiometricsEnabled(false);
          Alert.alert("Erreur", "Authentification échouée.");
        }
      } catch (error) {
        logger.error("[Settings] Biometrics error:", error);
        setBiometricsEnabled(false);
      }
    } else {
      setBiometricsEnabled(false);
      await auth.setBiometricsEnabled(false);
    }
  };

  /** Déconnexion immédiate, sans confirmation (ex. après suppression de compte). */
  const performLogout = () => {
    (async () => {
      await auth.logout();
      await refreshAuth();
    })().catch(() => {});
  };

  const handleLogout = () => {
    Alert.alert("Déconnexion", "Voulez-vous vraiment vous déconnecter ?", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Se déconnecter",
        style: "destructive",
        onPress: performLogout,
      },
    ]);
  };

  // Guest → "Se connecter": end the guest session so the app returns to the
  // Login screen (no destructive confirm — they're just leaving guest mode).
  const handleGuestSignIn = () => {
    (async () => {
      await auth.logout();
      await refreshAuth();
    })().catch(() => {});
  };

  const handleSelectPhoto = async () => {
    try {
      // Request permissions

      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      if (status !== "granted") {
        Alert.alert(
          "Permission requise",
          "Accès à la galerie photo nécessaire.",
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
        selectionLimit: 1,
      });

      if (
        !result.canceled &&
        result.assets.length > 0 &&
        result.assets[0].uri
      ) {
        const newUri = result.assets[0].uri;
        await auth.setLicensePhoto(newUri);
        setPhotoUri(newUri);
        Alert.alert("Succès", "Photo mise à jour.");
      }
    } catch (error) {
      logger.error("[Settings] Photo selection error:", error);
    }
  };

  const handleShowTechInfo = async () => {
    let isOnline = false;
    try {
      isOnline = await backendHealth.checkHealth();
    } catch {
      isOnline = false;
    }
    const statusText = isOnline ? "En ligne 🟢" : "Hors ligne 🔴";

    // Mêmes identifiants que TestFlight / Play, les tags GitHub et EAS : voir
    // utils/appIdentity. Lus au runtime (canal + bundle OTA réellement en
    // cours), pas sur les variables build-time qui divergent sous OTA.
    const id = getAppIdentity();

    const osVersion = Device.osVersion ?? "?";
    const deviceName = Device.modelName ?? "Appareil inconnu";
    const osLabel =
      Platform.OS === "ios"
        ? "iOS"
        : Platform.OS === "android"
          ? "Android"
          : Platform.OS;
    const host = STATIC_BASE_URL
      ? STATIC_BASE_URL.replace(/^https?:\/\//, "")
      : "(non configuré)";

    const lines = [
      `FFD Connect ${id.version}`,
      `Environnement : ${id.environment}`,
      `Code : ${id.code}`,
      `Mise à jour : ${id.update}`,
      `Compatibilité OTA : ${id.otaCompatibility}`,
      `Système : ${osLabel} ${osVersion}`,
      `Appareil : ${deviceName}`,
      `Backend : ${statusText}`,
      `Serveur : ${host}`,
    ];

    Alert.alert("Informations techniques", lines.join("\n"), [{ text: "OK" }]);
  };

  const handleSetTheme = async (pref: ThemePreference) => {
    await setPreference(pref);
  };

  const handleToggleAnimations = async () => {
    try {
      await toggleAnimations();
    } catch (error) {
      logger.error("[Settings] Toggle animations error:", error);
    }
  };

  const handleSetLibraryFilter = async (val: string) => {
    const mode = val as "default" | "style" | "likes";
    setDefaultFilter(mode);
    await auth.setDefaultLibraryFilter(mode);
  };

  const handleSetCompetitionScope = async (val: string) => {
    const scope = val as "all" | "registrant";
    setDefaultCompetitionScope(scope);
    await auth.setDefaultCompetitionScope(scope);
  };

  const handleSetCompetitionStatus = async (val: string) => {
    const status = val as "UPCOMING" | "LIVE" | "PAST" | "ALL";
    setDefaultCompetitionStatus(status);
    await auth.setDefaultCompetitionStatus(status);
  };

  const handleSetRegistrationPolicy = async (val: string) => {
    const policy = val as "CLUB_ONLY" | "MEMBER_VALIDATION" | "MEMBER_AUTO";
    setRegistrationPolicy(policy);
    const backendMode = {
      MEMBER_VALIDATION: "CLUB_AND_MEMBERS_PENDING" as const,
      CLUB_ONLY: "CLUB_ONLY" as const,
      MEMBER_AUTO: "MEMBERS_AUTO_CONFIRM" as const,
    }[policy];
    try {
      await ClubService.setRegistrationMode(backendMode);
      if (helloAssoStatus) {
        setHelloAssoStatus({
          ...helloAssoStatus,
          registrationMode: backendMode,
        });
      }
    } catch (e) {
      logger.error("[Settings] setRegistrationMode failed", e);
      Alert.alert("Erreur", "Impossible de modifier le mode d’inscription.");
    }
    await auth.setRegistrationPolicy(policy);
  };

  const handleToggleUsage = useCallback(async (on: boolean) => {
    setUsageEnabled(on);
    await usage.recorder.setEnabled(on);
  }, []);

  return {
    state: {
      currentTheme,
      preference,
      isDark,
      animationsEnabled,
      biometricsEnabled,
      biometryType,
      photoUri,
      defaultFilter,
      defaultCompetitionScope,
      defaultCompetitionStatus,
      role,
      registrationPolicy,
      helloAssoStatus,
      helloAssoModalVisible,
      reportModalVisible,
      changePasswordModalVisible,
      BiometryTypes,
      licenseExpiryDays,
      isStoreReview,
      usageEnabled,
    },
    actions: {
      setReportModalVisible,
      setChangePasswordModalVisible,
      setHelloAssoModalVisible,
      loadSettings,
      toggleBiometrics,
      handleLogout,
      performLogout,
      handleGuestSignIn,
      handleSelectPhoto,
      handleShowTechInfo,
      handleSetTheme,
      handleToggleAnimations,
      handleSetLibraryFilter,
      handleSetCompetitionScope,
      handleSetCompetitionStatus,
      handleSetRegistrationPolicy,
      handleToggleUsage,
    },
  };
};
