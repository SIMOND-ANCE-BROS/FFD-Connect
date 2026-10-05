import { ChevronRight, CreditCard, Users } from "lucide-react-native";
import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { AppTheme } from "../../../context/ThemeContext";
import type { HelloAssoStatus } from "../../club/services/ClubService";
import { styles } from "./settings.styles";

interface SettingsClubSectionProps {
  theme: AppTheme;
  registrationPolicy: string;
  handleSetRegistrationPolicy: (value: string) => Promise<void>;
  helloAssoStatus: HelloAssoStatus | null;
  onOpenHelloAsso: () => void;
}

export const SettingsClubSection: React.FC<SettingsClubSectionProps> = ({
  theme,
  registrationPolicy,
  handleSetRegistrationPolicy,
  helloAssoStatus,
  onOpenHelloAsso,
}) => (
  <>
    <View style={styles.sectionTitleContainer}>
      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
        Politique d'inscription
      </Text>
    </View>
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      <View style={[styles.row, styles.noPaddingBottom]}>
        <View style={styles.rowLeft}>
          <View style={[styles.iconBox, styles.organizerIconBox]}>
            <Users size={18} color="#9b59b6" />
          </View>
          <View>
            <Text style={[styles.rowLabel, { color: theme.text }]}>
              Qui inscrit les membres ?
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.policyContainer}>
        <View style={styles.gap12}>
          {[
            {
              label: "Club uniquement",
              value: "CLUB_ONLY",
              desc: "Seul le club peut inscrire les membres.",
            },
            {
              label: "Membre (avec validation)",
              value: "MEMBER_VALIDATION",
              desc: "Les membres s'inscrivent, le club valide.",
            },
            {
              label: "Membre (auto)",
              value: "MEMBER_AUTO",
              desc: "Inscription automatique sans validation.",
            },
          ].map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.policyOption,
                registrationPolicy === option.value
                  ? {
                      borderColor: theme.primary,
                      backgroundColor: `${theme.primary}10`,
                    }
                  : { borderColor: theme.border },
              ]}
              onPress={() => {
                handleSetRegistrationPolicy(option.value).catch(() => {});
              }}
              testID={`settings-reg-policy-${option.value}`}
              accessibilityLabel={`Politique d'inscription: ${option.label}`}
              accessibilityHint={`Sélectionne la politique d'inscription ${option.label}`}
            >
              <View
                style={[
                  styles.radioCircle,
                  {
                    borderColor:
                      registrationPolicy === option.value
                        ? theme.primary
                        : theme.textSecondary,
                  },
                ]}
              >
                {registrationPolicy === option.value && (
                  <View
                    style={[
                      styles.radioDot,
                      { backgroundColor: theme.primary },
                    ]}
                  />
                )}
              </View>
              <View style={styles.flex1}>
                <Text style={[styles.policyLabel, { color: theme.text }]}>
                  {option.label}
                </Text>
                <Text
                  style={[styles.policyDesc, { color: theme.textSecondary }]}
                >
                  {option.desc}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>

    {/* Paiement HelloAsso */}
    <View style={styles.sectionTitleContainer}>
      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
        Paiement
      </Text>
    </View>
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      <TouchableOpacity
        style={styles.row}
        onPress={onOpenHelloAsso}
        testID="settings-helloasso-button"
        accessibilityLabel="Compte HelloAsso du club"
        accessibilityHint="Ouvre la configuration du compte HelloAsso pour les paiements"
      >
        <View style={styles.rowLeft}>
          <View style={[styles.iconBox, styles.helloAssoIconBox]}>
            <CreditCard size={20} color="#00B894" />
          </View>
          <View>
            <Text style={[styles.rowLabel, { color: theme.text }]}>
              Compte HelloAsso
            </Text>
            <Text style={[styles.rowSubtext, { color: theme.textSecondary }]}>
              {helloAssoStatus?.helloAssoConnected
                ? `Connecté (${helloAssoStatus.organizationSlug ?? helloAssoStatus.clubName})`
                : "Non connecté — connectez pour accepter les paiements"}
            </Text>
          </View>
        </View>
        <View style={styles.rowRight}>
          <ChevronRight size={16} color={theme.textSecondary} />
        </View>
      </TouchableOpacity>
    </View>
  </>
);
