import React from "react";
import { Alert, View } from "react-native";
import { AppButton } from "../../../../components/AppButton";
import { AppText } from "../../../../components/AppText";
import type { AppTheme } from "../../../../context/ThemeContext";
import { styles } from "./competition-detail.styles";
import { formatDiscipline } from "../../../../utils/discipline";

interface PendingRegistration {
  id: string;
  user: { firstName: string; lastName: string };
  event: { category: string; ageGroup: string };
  eventId: string;
  userId: string;
}

interface CompetitionPendingSectionProps {
  currentTheme: AppTheme;
  pendingRegistrations: PendingRegistration[];
  handleConfirmRegistration: (registrationId: string) => void;
  handleUnregisterMember: (eventId: string, userId: string) => void;
}

export function CompetitionPendingSection({
  currentTheme,
  pendingRegistrations,
  handleConfirmRegistration,
  handleUnregisterMember,
}: CompetitionPendingSectionProps) {
  return (
    <View
      style={[
        styles.pendingSection,
        {
          backgroundColor: currentTheme.surface,
          borderColor: currentTheme.border,
        },
      ]}
    >
      <AppText variant="h3" style={[styles.mb8, { color: currentTheme.text }]}>
        Inscriptions en attente
      </AppText>
      {pendingRegistrations.map((reg) => (
        <View
          key={reg.id}
          style={[styles.pendingRow, { borderColor: currentTheme.border }]}
        >
          <View style={styles.flex1}>
            <AppText
              variant="body"
              weight="600"
              style={{ color: currentTheme.text }}
            >
              {reg.user.firstName} {reg.user.lastName}
            </AppText>
            <AppText
              variant="caption"
              style={{ color: currentTheme.textSecondary }}
            >
              {formatDiscipline(reg.event.category)} {reg.event.ageGroup}
            </AppText>
          </View>
          <View style={styles.rowGap8}>
            <AppButton
              title="Valider"
              onPress={() => handleConfirmRegistration(reg.id)}
              variant="primary"
              style={styles.smallButton}
            />
            <AppButton
              title="Refuser"
              onPress={() =>
                Alert.alert("Désinscrire", "Désinscrire ce membre ?", [
                  { text: "Annuler", style: "cancel" },
                  {
                    text: "Désinscrire",
                    style: "destructive",
                    onPress: () =>
                      handleUnregisterMember(reg.eventId, reg.userId),
                  },
                ])
              }
              variant="outline"
              style={styles.smallButton}
            />
          </View>
        </View>
      ))}
    </View>
  );
}
