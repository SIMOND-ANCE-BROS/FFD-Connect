import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AlertTriangle, LogIn, LogOut, UserCog } from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { AppText } from "../../../components/AppText";
import {
  GlassHeader,
  GLASS_HEADER_HEIGHT,
} from "../../../components/GlassHeader";
import { ImpersonationModal } from "../components/ImpersonationModal";
import { NotificationBell } from "../../../components/NotificationBell";
import { useClubLogo } from "../../../stores/club.store";
import { useNotificationPreferencesStore } from "../../../stores";
import { RootStackParamList } from "../../../navigation/types";
import * as ImagePicker from "expo-image-picker";
import { ReportModal } from "../../competitions/components/ReportModal";
import { useSettingsLogic } from "../../settings/hooks/useSettingsLogic";
import { ChangePasswordModal } from "../components/ChangePasswordModal";
import { DeleteAccountModal } from "../components/DeleteAccountModal";
import { HelloAssoModal } from "../components/HelloAssoModal";
import { SettingsPrivacySection } from "../components/SettingsPrivacySection";
import { exportAndShareMyData } from "../services/PrivacyService";
import { LegalDoc } from "../../legal/legalContent";
import { styles } from "../components/settings.styles";
import type { UserRole } from "../../auth/services/AuthService";
import { SpaceSelector } from "../components/SpaceSelector";
import { AuthService } from "../../auth/services/AuthService";
import { useAuthStore } from "../../../stores/auth.store";
import { SettingsClubSection } from "../components/SettingsClubSection";
import { SettingsFiltersSection } from "../components/SettingsFiltersSection";
import { SettingsInterfaceSection } from "../components/SettingsInterfaceSection";
import { SettingsNotificationsSection } from "../components/SettingsNotificationsSection";
import { SettingsProfileSection } from "../components/SettingsProfileSection";
import { SettingsSecuritySection } from "../components/SettingsSecuritySection";
import { SettingsTechnicalSection } from "../components/SettingsTechnicalSection";
import { TrackCorrectionsSettingsSection } from "../../track-corrections/components/TrackCorrectionsSettingsSection";

type SettingsScreenProps = NativeStackScreenProps<
  RootStackParamList,
  "Settings"
>;

export const SettingsScreen = ({ navigation }: SettingsScreenProps) => {
  const insets = useSafeAreaInsets();
  const { state, actions } = useSettingsLogic({ navigation });
  const { clubLogoUri, setClubLogo } = useClubLogo();
  const roles = useAuthStore((s) => s.roles);
  const refreshAuth = useAuthStore((s) => s.refreshAuth);
  // Admin actions (impersonation, correction review) follow every role.
  const isAdminAccount = useAuthStore((s) => s.hasRole("ADMIN"));
  const [deleteAccountModalVisible, setDeleteAccountModalVisible] =
    React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  // Impersonation admin (#545) — remplace l'ancien switch de profil preview.
  const [impersonationVisible, setImpersonationVisible] = useState(false);

  const {
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
  } = state;

  const {
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
  } = actions;

  const handleSelectClubLogo = useCallback(async () => {
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      if (status !== "granted") {
        Alert.alert(
          "Permission requise",
          "Accès à la galerie photo nécessaire pour choisir le logo du club.",
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        selectionLimit: 1,
      });
      if (
        !result.canceled &&
        result.assets.length > 0 &&
        result.assets[0].uri
      ) {
        await setClubLogo(result.assets[0].uri);
        Alert.alert("Succès", "Logo du club mis à jour.");
      }
    } catch {
      Alert.alert("Erreur", "Impossible de charger l'image.");
    }
  }, [setClubLogo]);

  const handleChangeSpace = useCallback(
    async (space: UserRole) => {
      await AuthService.setActiveSpace(space);
      await refreshAuth();
      await loadSettings();
    },
    [refreshAuth, loadSettings],
  );

  const isFaceId = biometryType === BiometryTypes.FaceID;
  const isGuest = role === "GUEST";

  // --- Préférences de notification (#37) ---
  const notificationPreferences = useNotificationPreferencesStore(
    (s) => s.preferences,
  );
  const notificationPreferencesLoading = useNotificationPreferencesStore(
    (s) => s.loading,
  );
  const notificationPreferencesPending = useNotificationPreferencesStore(
    (s) => s.pending,
  );
  const notificationPreferencesError = useNotificationPreferencesStore(
    (s) => s.error,
  );
  const loadNotificationPreferences = useNotificationPreferencesStore(
    (s) => s.load,
  );
  const setNotificationPreference = useNotificationPreferencesStore(
    (s) => s.setPreference,
  );

  useEffect(() => {
    if (isGuest) return;
    void loadNotificationPreferences();
  }, [isGuest, loadNotificationPreferences]);
  const scrollY = useRef(new Animated.Value(0)).current;

  // --- Confidentialité et données (#424, RGPD) ---
  const handleExportData = useCallback(() => {
    setExporting(true);
    exportAndShareMyData()
      .catch(() => {
        Alert.alert(
          "Erreur",
          "L'export a échoué. Vérifiez votre connexion et réessayez.",
        );
      })
      .finally(() => setExporting(false));
  }, []);

  const handleDeleteAccountPress = useCallback(() => {
    // Première confirmation légère — la modale exige ensuite le mot de passe.
    Alert.alert(
      "Supprimer mon compte ?",
      "Toutes vos données seront définitivement supprimées. Cette action est irréversible.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Continuer",
          style: "destructive",
          onPress: () => setDeleteAccountModalVisible(true),
        },
      ],
    );
  }, []);

  const handleOpenLegal = useCallback(
    (doc: LegalDoc) => {
      navigation.navigate("Legal", { doc });
    },
    [navigation],
  );

  const securityProps = {
    theme: currentTheme,
    biometryType,
    biometricsEnabled,
    toggleBiometrics,
    isFaceId,
    onChangePassword: () => setChangePasswordModalVisible(true),
    isGuest: role === "GUEST",
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: currentTheme.background }]}
      edges={["left", "right"]}
    >
      <StatusBar
        barStyle={currentTheme.statusBarStyle}
        backgroundColor={currentTheme.background}
      />

      <GlassHeader
        theme={currentTheme}
        isDark={isDark}
        title="Réglages"
        scrollY={scrollY}
        right={
          <View style={headerStyles.actions}>
            {!isGuest && (
              <NotificationBell
                theme={currentTheme}
                isDark={isDark}
                enabled={!isGuest}
                onPress={() => navigation.navigate("Notifications")}
              />
            )}
            <TouchableOpacity
              onPress={() => {
                if (isGuest) {
                  handleGuestSignIn();
                } else {
                  handleLogout();
                }
              }}
              testID={
                isGuest ? "settings-login-button" : "settings-logout-button"
              }
              accessibilityLabel={isGuest ? "Se connecter" : "Se déconnecter"}
              accessibilityHint={
                isGuest
                  ? "Quitte le mode invité pour se connecter"
                  : "Déconnecte l'utilisateur de l'application"
              }
              style={[
                styles.logoutButton,
                isDark ? styles.actionButtonDark : styles.actionButtonLight,
                { borderColor: currentTheme.border },
              ]}
            >
              {isGuest ? (
                <LogIn color={currentTheme.text} size={22} />
              ) : (
                <LogOut color={currentTheme.text} size={22} />
              )}
            </TouchableOpacity>
          </View>
        }
      />

      <Animated.ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + GLASS_HEADER_HEIGHT + 8,
            paddingBottom: insets.bottom + 120,
          },
        ]}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
      >
        <SpaceSelector
          roles={roles}
          space={role}
          onChange={(space) => {
            handleChangeSpace(space).catch(() => {});
          }}
        />

        {isAdminAccount && (
          <TouchableOpacity
            onPress={() => setImpersonationVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Se connecter en tant qu'un utilisateur"
            accessibilityHint="Ouvre la recherche d'utilisateur pour l'impersonation"
            testID="settings-impersonation-button"
            style={[
              profileSwitchStyles.banner,
              { backgroundColor: "#8e44ad18" },
            ]}
          >
            <UserCog size={20} color="#8e44ad" />
            <AppText
              variant="body"
              color="#8e44ad"
              style={profileSwitchStyles.text}
            >
              Se connecter en tant que (impersonation)
            </AppText>
          </TouchableOpacity>
        )}

        {licenseExpiryDays !== null && (
          <View
            style={[
              licenseExpiryStyles.banner,
              { backgroundColor: `${currentTheme.warning}20` },
            ]}
          >
            <AlertTriangle size={20} color={currentTheme.warning} />
            <AppText
              variant="body"
              color={currentTheme.warning}
              style={licenseExpiryStyles.text}
            >
              Votre licence expire dans {licenseExpiryDays} jour
              {licenseExpiryDays > 1 ? "s" : ""}. Contactez votre club pour le
              renouvellement.
            </AppText>
          </View>
        )}

        <SettingsProfileSection
          theme={currentTheme}
          role={role}
          photoUri={photoUri}
          clubLogoUri={clubLogoUri}
          onSelectPhoto={() => {
            handleSelectPhoto().catch(() => {});
          }}
          onSelectClubLogo={() => {
            handleSelectClubLogo().catch(() => {});
          }}
        />

        {/* Security appears right after profile for both roles */}
        <SettingsSecuritySection {...securityProps} />

        {role === "CLUB" && (
          <SettingsClubSection
            theme={currentTheme}
            registrationPolicy={registrationPolicy}
            handleSetRegistrationPolicy={handleSetRegistrationPolicy}
            helloAssoStatus={helloAssoStatus}
            onOpenHelloAsso={() => setHelloAssoModalVisible(true)}
          />
        )}

        {role === "LICENSEE" && (
          <SettingsFiltersSection
            theme={currentTheme}
            defaultFilter={defaultFilter}
            handleSetLibraryFilter={handleSetLibraryFilter}
            defaultCompetitionScope={defaultCompetitionScope}
            handleSetCompetitionScope={handleSetCompetitionScope}
            defaultCompetitionStatus={defaultCompetitionStatus}
            handleSetCompetitionStatus={handleSetCompetitionStatus}
          />
        )}

        <SettingsInterfaceSection
          theme={currentTheme}
          isDark={isDark}
          preference={preference}
          handleSetTheme={handleSetTheme}
          animationsEnabled={animationsEnabled}
          handleToggleAnimations={handleToggleAnimations}
        />

        {/* Les préférences supposent un compte : rien à régler pour un invité. */}
        {!isGuest && (
          <SettingsNotificationsSection
            theme={currentTheme}
            preferences={notificationPreferences}
            loading={notificationPreferencesLoading}
            pending={notificationPreferencesPending}
            error={notificationPreferencesError}
            onToggle={(type, enabled) => {
              void setNotificationPreference(type, enabled);
            }}
          />
        )}

        {/* Propositions de correction des musiques : suivi pour tout compte,
            file de validation pour l'admin. */}
        {!isGuest && (
          <TrackCorrectionsSettingsSection
            theme={currentTheme}
            isAdmin={isAdminAccount}
            onOpenMine={() => navigation.navigate("MyTrackCorrections")}
            onOpenReview={() => navigation.navigate("TrackCorrectionsReview")}
          />
        )}

        <SettingsPrivacySection
          theme={currentTheme}
          isGuest={isGuest}
          exporting={exporting}
          onExportData={handleExportData}
          onDeleteAccount={handleDeleteAccountPress}
          onOpenLegal={handleOpenLegal}
        />

        <SettingsTechnicalSection
          theme={currentTheme}
          handleShowTechInfo={handleShowTechInfo}
          onOpenReportModal={() => setReportModalVisible(true)}
        />

        <ReportModal
          visible={reportModalVisible}
          onClose={() => setReportModalVisible(false)}
        />

        <ChangePasswordModal
          visible={changePasswordModalVisible}
          onClose={() => setChangePasswordModalVisible(false)}
        />

        {isAdminAccount && (
          <ImpersonationModal
            visible={impersonationVisible}
            onClose={() => setImpersonationVisible(false)}
          />
        )}

        <DeleteAccountModal
          visible={deleteAccountModalVisible}
          onClose={() => setDeleteAccountModalVisible(false)}
          onDeleted={() => {
            Alert.alert(
              "Compte supprimé",
              "Vos données ont été supprimées. Au revoir 👋",
            );
            performLogout();
          }}
        />

        <HelloAssoModal
          visible={helloAssoModalVisible}
          onClose={() => setHelloAssoModalVisible(false)}
          onSuccess={() => {
            loadSettings().catch(() => {});
          }}
        />
      </Animated.ScrollView>
    </SafeAreaView>
  );
};

const licenseExpiryStyles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    marginBottom: 20,
  },
  text: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
  },
});

const headerStyles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
});

const profileSwitchStyles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  text: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    fontWeight: "600",
  },
});
