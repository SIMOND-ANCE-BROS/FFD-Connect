import { Camera, User, Users } from "lucide-react-native";
import React from "react";
import { Image, Text, TouchableOpacity, View } from "react-native";
import { AppTheme } from "../../../context/ThemeContext";
import { UserRole } from "../../auth/services/AuthService";
import { styles } from "./settings.styles";

interface SettingsProfileSectionProps {
  theme: AppTheme;
  role: UserRole;
  photoUri: string | null;
  clubLogoUri: string | null;
  onSelectPhoto: () => void;
  onSelectClubLogo: () => void;
}

export const SettingsProfileSection: React.FC<SettingsProfileSectionProps> = ({
  theme,
  role,
  photoUri,
  clubLogoUri,
  onSelectPhoto,
  onSelectClubLogo,
}) => {
  if (role === "LICENSEE") {
    return (
      <View style={styles.profileSection}>
        <TouchableOpacity
          onPress={onSelectPhoto}
          activeOpacity={0.8}
          testID="settings-avatar-button"
          accessibilityLabel="Changer ma photo de profil"
          accessibilityHint="Ouvre la bibliothèque photo pour changer l'avatar"
        >
          <View style={[styles.avatarContainer, { borderColor: theme.border }]}>
            {photoUri ? (
              <Image
                testID="settings-avatar-image"
                source={{ uri: photoUri }}
                style={styles.avatarImage}
              />
            ) : (
              <View
                testID="settings-avatar-placeholder"
                style={[
                  styles.avatarPlaceholder,
                  { backgroundColor: theme.surface },
                ]}
              >
                <User size={40} color={theme.textSecondary} />
              </View>
            )}
            <View
              style={[
                styles.editBadge,
                {
                  backgroundColor: theme.primary,
                  borderColor: theme.background,
                },
              ]}
            >
              <Camera size={14} color="#FFF" />
            </View>
          </View>
        </TouchableOpacity>
        <Text style={[styles.changePhotoText, { color: theme.primary }]}>
          Modifier ma photo
        </Text>
      </View>
    );
  }

  if (role === "CLUB") {
    return (
      <View style={styles.profileSection}>
        <TouchableOpacity
          onPress={onSelectClubLogo}
          activeOpacity={0.8}
          testID="settings-club-logo-button"
          accessibilityLabel="Changer le logo du club"
          accessibilityHint="Ouvre la galerie pour choisir une image"
        >
          <View style={[styles.avatarContainer, { borderColor: theme.border }]}>
            {clubLogoUri ? (
              <Image
                testID="settings-club-logo-image"
                source={{ uri: clubLogoUri }}
                style={styles.avatarImage}
              />
            ) : (
              <View
                testID="settings-club-logo-placeholder"
                style={[
                  styles.avatarPlaceholder,
                  { backgroundColor: theme.surface },
                ]}
              >
                <Users size={40} color={theme.textSecondary} />
              </View>
            )}
            <View
              style={[
                styles.editBadge,
                {
                  backgroundColor: theme.primary,
                  borderColor: theme.background,
                },
              ]}
            >
              <Camera size={14} color="#FFF" />
            </View>
          </View>
        </TouchableOpacity>
        <Text style={[styles.changePhotoText, { color: theme.primary }]}>
          Modifier le logo
        </Text>
      </View>
    );
  }

  return null;
};
