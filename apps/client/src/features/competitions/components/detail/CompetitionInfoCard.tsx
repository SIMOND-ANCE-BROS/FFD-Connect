import { Calendar, Mail, MapPin, User } from "lucide-react-native";
import React from "react";
import { View } from "react-native";
import { AppText } from "../../../../components/AppText";
import type { AppTheme } from "../../../../context/ThemeContext";
import type { Competition } from "../../context/CompetitionContext";
import { styles } from "./competition-detail.styles";

interface CompetitionInfoCardProps {
  currentTheme: AppTheme;
  details: Competition;
}

export function CompetitionInfoCard({
  currentTheme,
  details,
}: CompetitionInfoCardProps) {
  return (
    <View style={[styles.infoCard, { backgroundColor: currentTheme.surface }]}>
      <View style={styles.infoRow}>
        <Calendar
          size={20}
          color={currentTheme.primary}
          style={styles.iconSpacing}
        />
        <View style={styles.infoContent}>
          <AppText variant="caption" color={currentTheme.textSecondary}>
            Date
          </AppText>
          <AppText variant="body" color={currentTheme.text}>
            {new Date(details.date).toLocaleDateString()}
          </AppText>
        </View>
      </View>

      <View style={styles.separator} />

      <View style={styles.infoRow}>
        <MapPin
          size={20}
          color={currentTheme.primary}
          style={styles.iconSpacing}
        />
        <View style={styles.infoContent}>
          <AppText variant="caption" color={currentTheme.textSecondary}>
            Lieu
          </AppText>
          <AppText variant="body" color={currentTheme.text}>
            {details.address ? `${details.address}, ` : ""}
            {details.zipCode ? `${details.zipCode} ` : ""}
            {details.city ?? details.location}
          </AppText>
        </View>
      </View>

      <View style={styles.separator} />

      <View style={styles.infoRow}>
        <User
          size={20}
          color={currentTheme.primary}
          style={styles.iconSpacing}
        />
        <View style={styles.infoContent}>
          <AppText variant="caption" color={currentTheme.textSecondary}>
            Organisateur
          </AppText>
          <AppText variant="body" color={currentTheme.text}>
            {details.organizer ?? "Non spécifié"}
          </AppText>
        </View>
      </View>

      {!!details.organizerEmail && (
        <>
          <View style={styles.separator} />
          <View style={styles.infoRow}>
            <Mail
              size={20}
              color={currentTheme.primary}
              style={styles.iconSpacing}
            />
            <View style={styles.infoContent}>
              <AppText variant="caption" color={currentTheme.textSecondary}>
                Contact
              </AppText>
              <AppText variant="body" color={currentTheme.text}>
                {details.organizerEmail}
              </AppText>
            </View>
          </View>
        </>
      )}
    </View>
  );
}
