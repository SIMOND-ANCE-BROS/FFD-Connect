import {
  BarChart3,
  ChevronRight,
  Download,
  FileText,
  Shield,
  Trash2,
} from "lucide-react-native";
import React, { type RefObject } from "react";
import {
  ActivityIndicator,
  Switch,
  TouchableOpacity,
  View,
} from "react-native";
import { AppText } from "../../../components/AppText";
import { AppTheme } from "../../../context/ThemeContext";
import { LegalDoc } from "../../legal/legalContent";
import { styles } from "./settings.styles";

interface SettingsPrivacySectionProps {
  theme: AppTheme;
  /** Invité : pas de compte → pas d'export ni de suppression, docs légaux seulement. */
  isGuest: boolean;
  exporting: boolean;
  onExportData: () => void;
  onDeleteAccount: () => void;
  onOpenLegal: (doc: LegalDoc) => void;
  /** Mesure d'audience anonyme (lot 5) ; null pendant le chargement. */
  usageEnabled: boolean | null;
  onToggleUsage: (on: boolean) => void;
  /** Receives the screen-reader focus back when the deletion modal closes. */
  deleteAccountRef?: RefObject<View | null>;
}

/**
 * Section « Confidentialité et données » (#424) : droits RGPD (export,
 * suppression de compte) + accès aux documents légaux.
 */
export const SettingsPrivacySection: React.FC<SettingsPrivacySectionProps> = ({
  theme,
  isGuest,
  exporting,
  onExportData,
  onDeleteAccount,
  onOpenLegal,
  usageEnabled,
  onToggleUsage,
  deleteAccountRef,
}) => (
  <>
    <View style={styles.sectionTitleContainer}>
      <AppText
        variant="caption"
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: theme.textSecondary }]}
      >
        Confidentialité et données
      </AppText>
    </View>

    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      {usageEnabled !== null && (
        <View style={styles.row}>
          <View style={[styles.rowLeft, { flex: 1 }]}>
            <View style={[styles.iconBox, { backgroundColor: "#8e44ad20" }]}>
              <BarChart3 size={20} color="#8e44ad" />
            </View>
            <View style={{ flex: 1 }}>
              <AppText
                variant="body"
                style={[styles.rowLabel, { color: theme.text }]}
              >
                Mesure d'audience anonyme
              </AppText>
              <AppText variant="caption" color={theme.textSecondary}>
                Statistiques d'usage anonymes, sans lien avec votre compte.
              </AppText>
            </View>
          </View>
          <Switch
            testID="settings-usage-switch"
            value={usageEnabled}
            onValueChange={onToggleUsage}
            accessibilityLabel="Mesure d'audience anonyme"
            accessibilityHint="Active ou désactive les statistiques d'usage anonymes"
          />
        </View>
      )}

      {!isGuest && (
        <TouchableOpacity
          accessibilityRole="button"
          style={[
            styles.row,
            usageEnabled !== null && styles.borderTop,
            usageEnabled !== null && { borderTopColor: theme.border },
          ]}
          onPress={onExportData}
          disabled={exporting}
          accessibilityState={{ disabled: exporting, busy: exporting }}
          testID="settings-export-data-button"
          accessibilityLabel="Exporter mes données"
          accessibilityHint="Télécharge toutes vos données personnelles au format JSON (RGPD)"
        >
          <View style={styles.rowLeft}>
            <View style={[styles.iconBox, { backgroundColor: "#3498db20" }]}>
              <Download size={20} color="#3498db" />
            </View>
            <AppText
              variant="body"
              style={[styles.rowLabel, { color: theme.text }]}
            >
              Exporter mes données
            </AppText>
          </View>
          <View style={styles.rowRight}>
            {exporting ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <ChevronRight size={16} color={theme.textSecondary} />
            )}
          </View>
        </TouchableOpacity>
      )}

      {(
        [
          ["cgu", "Conditions générales d'utilisation"],
          ["privacy", "Politique de confidentialité"],
          ["mentions", "Mentions légales"],
        ] as [LegalDoc, string][]
      ).map(([doc, label], index) => (
        <TouchableOpacity
          accessibilityRole="button"
          key={doc}
          style={[
            styles.row,
            (index > 0 || !isGuest || usageEnabled !== null) &&
              styles.borderTop,
            (index > 0 || !isGuest || usageEnabled !== null) && {
              borderTopColor: theme.border,
            },
          ]}
          onPress={() => onOpenLegal(doc)}
          testID={`settings-legal-${doc}-button`}
          accessibilityLabel={label}
          accessibilityHint={`Ouvre ${label}`}
        >
          <View style={styles.rowLeft}>
            <View style={[styles.iconBox, { backgroundColor: "#95a5a620" }]}>
              {doc === "privacy" ? (
                <Shield size={20} color="#95a5a6" />
              ) : (
                <FileText size={20} color="#95a5a6" />
              )}
            </View>
            <AppText
              variant="body"
              style={[styles.rowLabel, { color: theme.text }]}
            >
              {label}
            </AppText>
          </View>
          <View style={styles.rowRight}>
            <ChevronRight size={16} color={theme.textSecondary} />
          </View>
        </TouchableOpacity>
      ))}

      {!isGuest && (
        <TouchableOpacity
          ref={deleteAccountRef}
          accessibilityRole="button"
          style={[
            styles.row,
            styles.borderTop,
            { borderTopColor: theme.border },
          ]}
          onPress={onDeleteAccount}
          testID="settings-delete-account-button"
          accessibilityLabel="Supprimer mon compte"
          accessibilityHint="Supprime définitivement votre compte et vos données (irréversible)"
        >
          <View style={styles.rowLeft}>
            {/* Danger tokens: #e74c3c was 3.8:1 as text on white. */}
            <View
              style={[styles.iconBox, { backgroundColor: `${theme.danger}20` }]}
            >
              <Trash2 size={20} color={theme.dangerText} />
            </View>
            <AppText
              variant="body"
              style={[styles.rowLabel, { color: theme.dangerText }]}
            >
              Supprimer mon compte
            </AppText>
          </View>
          <View style={styles.rowRight}>
            <ChevronRight size={16} color={theme.textSecondary} />
          </View>
        </TouchableOpacity>
      )}
    </View>
  </>
);
