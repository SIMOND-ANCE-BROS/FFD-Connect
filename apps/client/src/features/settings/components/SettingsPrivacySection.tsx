import {
  BarChart3,
  ChevronRight,
  Download,
  FileText,
  Shield,
  Trash2,
} from "lucide-react-native";
import React from "react";
import {
  ActivityIndicator,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
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
}) => (
  <>
    <View style={styles.sectionTitleContainer}>
      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
        Confidentialité et données
      </Text>
    </View>

    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      {usageEnabled !== null && (
        <View style={styles.row}>
          <View style={[styles.rowLeft, { flex: 1 }]}>
            <View style={[styles.iconBox, { backgroundColor: "#8e44ad20" }]}>
              <BarChart3 size={20} color="#8e44ad" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: theme.text }]}>
                Mesure d'audience anonyme
              </Text>
              <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                Statistiques d'usage anonymes, sans lien avec votre compte.
              </Text>
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
          style={[
            styles.row,
            usageEnabled !== null && styles.borderTop,
            usageEnabled !== null && { borderTopColor: theme.border },
          ]}
          onPress={onExportData}
          disabled={exporting}
          testID="settings-export-data-button"
          accessibilityLabel="Exporter mes données"
          accessibilityHint="Télécharge toutes vos données personnelles au format JSON (RGPD)"
        >
          <View style={styles.rowLeft}>
            <View style={[styles.iconBox, { backgroundColor: "#3498db20" }]}>
              <Download size={20} color="#3498db" />
            </View>
            <Text style={[styles.rowLabel, { color: theme.text }]}>
              Exporter mes données
            </Text>
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
            <Text style={[styles.rowLabel, { color: theme.text }]}>
              {label}
            </Text>
          </View>
          <View style={styles.rowRight}>
            <ChevronRight size={16} color={theme.textSecondary} />
          </View>
        </TouchableOpacity>
      ))}

      {!isGuest && (
        <TouchableOpacity
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
            <View style={[styles.iconBox, { backgroundColor: "#e74c3c20" }]}>
              <Trash2 size={20} color="#e74c3c" />
            </View>
            <Text style={[styles.rowLabel, { color: "#e74c3c" }]}>
              Supprimer mon compte
            </Text>
          </View>
          <View style={styles.rowRight}>
            <ChevronRight size={16} color={theme.textSecondary} />
          </View>
        </TouchableOpacity>
      )}
    </View>
  </>
);
