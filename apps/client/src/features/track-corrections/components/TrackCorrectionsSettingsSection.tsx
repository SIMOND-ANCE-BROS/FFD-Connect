import { ChevronRight, ClipboardCheck, Music } from "lucide-react-native";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AppTheme } from "../../../context/ThemeContext";
import { styles } from "../../settings/components/settings.styles";
import { usePendingTrackCorrectionsCount } from "../hooks/useTrackCorrections";

interface TrackCorrectionsSettingsSectionProps {
  theme: AppTheme;
  isAdmin: boolean;
  onOpenMine: () => void;
  onOpenReview: () => void;
}

/**
 * Section « Musiques » des réglages : suivi de ses propositions de correction
 * pour tout compte connecté, et file de modération (avec badge) pour l'admin.
 */
export const TrackCorrectionsSettingsSection = ({
  theme,
  isAdmin,
  onOpenMine,
  onOpenReview,
}: TrackCorrectionsSettingsSectionProps) => {
  const pendingCount = usePendingTrackCorrectionsCount(isAdmin);

  return (
    <>
      <View style={styles.sectionTitleContainer}>
        <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          Musiques
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        {isAdmin && (
          <TouchableOpacity
            style={styles.row}
            onPress={onOpenReview}
            testID="settings-track-corrections-review"
            accessibilityRole="button"
            accessibilityLabel={
              pendingCount > 0
                ? `Propositions de correction, ${pendingCount} en attente`
                : "Propositions de correction"
            }
            accessibilityHint="Ouvre la file de validation des corrections de musiques"
          >
            <View style={[styles.rowLeft, styles.rowLeftFlexible]}>
              <View style={[styles.iconBox, local.reviewIconBox]}>
                <ClipboardCheck size={20} color="#8e44ad" />
              </View>
              <Text style={[styles.rowLabel, { color: theme.text }]}>
                Propositions de correction
              </Text>
            </View>
            <View style={styles.rowRight}>
              {pendingCount > 0 && (
                <View
                  style={[local.badge, { backgroundColor: theme.danger }]}
                  testID="settings-track-corrections-badge"
                >
                  <Text style={local.badgeText}>
                    {pendingCount > 99 ? "99+" : pendingCount}
                  </Text>
                </View>
              )}
              <ChevronRight size={16} color={theme.textSecondary} />
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[
            styles.row,
            isAdmin && styles.borderTop,
            isAdmin && { borderTopColor: theme.border },
          ]}
          onPress={onOpenMine}
          testID="settings-my-track-corrections"
          accessibilityRole="button"
          accessibilityLabel="Mes propositions de correction"
          accessibilityHint="Affiche le suivi de vos propositions de correction de musiques"
        >
          <View style={[styles.rowLeft, styles.rowLeftFlexible]}>
            <View style={[styles.iconBox, local.mineIconBox]}>
              <Music size={20} color={theme.primary} />
            </View>
            <Text style={[styles.rowLabel, { color: theme.text }]}>
              Mes propositions de correction
            </Text>
          </View>
          <View style={styles.rowRight}>
            <ChevronRight size={16} color={theme.textSecondary} />
          </View>
        </TouchableOpacity>
      </View>
    </>
  );
};

const local = StyleSheet.create({
  reviewIconBox: { backgroundColor: "rgba(142, 68, 173, 0.1)" },
  mineIconBox: { backgroundColor: "rgba(0, 136, 206, 0.1)" },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#FFF", fontSize: 12, fontWeight: "700" },
});
