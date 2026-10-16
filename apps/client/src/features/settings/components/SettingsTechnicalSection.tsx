import { ChevronRight, Info, MessageSquare } from "lucide-react-native";
import React, { type RefObject } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { APP_VERSION_LABEL } from "../../../config";
import { AppTheme } from "../../../context/ThemeContext";
import { styles } from "./settings.styles";

interface SettingsTechnicalSectionProps {
  theme: AppTheme;
  handleShowTechInfo: () => Promise<void>;
  onOpenReportModal: () => void;
  /** Receives the screen-reader focus back when the report modal closes. */
  reportRef?: RefObject<View | null>;
}

export const SettingsTechnicalSection: React.FC<
  SettingsTechnicalSectionProps
> = ({ theme, handleShowTechInfo, onOpenReportModal, reportRef }) => (
  <>
    <View style={styles.sectionTitleContainer}>
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: theme.textSecondary }]}
      >
        Technique
      </Text>
    </View>

    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      {/* Tech Info Row */}
      <TouchableOpacity
        accessibilityRole="button"
        style={styles.row}
        onPress={() => {
          handleShowTechInfo().catch(() => {});
        }}
        testID="settings-tech-info-button"
        accessibilityLabel="Afficher les informations techniques"
        accessibilityHint="Affiche une popup avec l'état du backend"
      >
        <View style={styles.rowLeft}>
          <View style={[styles.iconBox, styles.technicalIconBox]}>
            <Info size={20} color="#808080" />
          </View>
          <Text style={[styles.rowLabel, { color: theme.text }]}>
            Informations techniques
          </Text>
        </View>
        <View style={styles.rowRight}>
          <ChevronRight size={16} color={theme.textSecondary} />
        </View>
      </TouchableOpacity>

      {/* Report Bug */}
      <TouchableOpacity
        ref={reportRef}
        accessibilityRole="button"
        style={[styles.row, styles.borderTop, { borderTopColor: theme.border }]}
        onPress={onOpenReportModal}
        testID="settings-report-bug-button"
        accessibilityLabel="Faire un retour ou signaler un bug"
        accessibilityHint="Ouvre la modale de signalement"
      >
        <View style={styles.rowLeft}>
          <View style={[styles.iconBox, styles.reportIconBox]}>
            <MessageSquare size={20} color="#e74c3c" />
          </View>
          <Text style={[styles.rowLabel, { color: theme.text }]}>
            Faire un retour
          </Text>
        </View>
        <View style={styles.rowRight}>
          <ChevronRight size={16} color={theme.textSecondary} />
        </View>
      </TouchableOpacity>
    </View>

    {/* Version Info Footer */}
    <View style={styles.footer}>
      <Text style={[styles.versionText, { color: theme.textSecondary }]}>
        FFD Connect {APP_VERSION_LABEL}
      </Text>
    </View>
  </>
);
