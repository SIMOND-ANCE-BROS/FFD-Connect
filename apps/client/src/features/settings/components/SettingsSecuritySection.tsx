import { ChevronRight, Key, Shield } from "lucide-react-native";
import React from "react";
import { Switch, Text, TouchableOpacity, View } from "react-native";
import { AppTheme } from "../../../context/ThemeContext";
import { styles } from "./settings.styles";

interface SettingsSecuritySectionProps {
  theme: AppTheme;
  biometryType: string | undefined;
  biometricsEnabled: boolean;
  toggleBiometrics: (value: boolean) => void;
  isFaceId: boolean;
  onChangePassword: () => void;
  isGuest?: boolean;
}

export const SettingsSecuritySection: React.FC<
  SettingsSecuritySectionProps
> = ({
  theme,
  biometryType,
  biometricsEnabled,
  toggleBiometrics,
  isFaceId,
  onChangePassword,
  isGuest = false,
}) => {
  // A guest has no account password to change and no biometrics tied to a real
  // session — hide the whole Security section (including Face ID) for guests.
  if (isGuest) return null;

  return (
    <>
      <View style={styles.sectionTitleContainer}>
        <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          Sécurité
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        {/* Change Password (guests never reach here — section returns null). */}
        <TouchableOpacity
          style={styles.row}
          onPress={onChangePassword}
          testID="settings-change-password-button"
          accessibilityLabel="Changer le mot de passe"
          accessibilityHint="Ouvre la modale pour changer le mot de passe"
        >
          <View style={styles.rowLeft}>
            <View style={[styles.iconBox, styles.passwordIconBox]}>
              <Key size={20} color="#FF9500" />
            </View>
            <Text style={[styles.rowLabel, { color: theme.text }]}>
              Changer le mot de passe
            </Text>
          </View>
          <View style={styles.rowRight}>
            <ChevronRight size={16} color={theme.textSecondary} />
          </View>
        </TouchableOpacity>

        {/* Biometrics */}
        {biometryType && (
          <View
            style={[
              styles.row,
              styles.borderTop,
              { borderTopColor: theme.border },
            ]}
          >
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, styles.securityIconBox]}>
                <Shield size={20} color="#34C759" />
              </View>
              <Text style={[styles.rowLabel, { color: theme.text }]}>
                {isFaceId ? "Face ID" : "Biométrie"}
              </Text>
            </View>
            <Switch
              trackColor={{
                false: "#767577",
                true: theme.primary,
              }}
              thumbColor={biometricsEnabled ? "#fff" : "#f4f3f4"}
              ios_backgroundColor="#3e3e3e"
              onValueChange={toggleBiometrics}
              value={biometricsEnabled}
              testID="settings-biometrics-switch"
              accessibilityLabel="Activer la biométrie"
              accessibilityHint="Active ou désactive la connexion biométrique"
            />
          </View>
        )}
      </View>
    </>
  );
};
