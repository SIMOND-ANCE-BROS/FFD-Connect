import { ChevronRight, CreditCard, Users } from "lucide-react-native";
import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { AppTheme } from "../../../context/ThemeContext";
import type { HelloAssoStatus } from "../../club/services/ClubService";
import {
  canChoosePaymentProvider,
  isHelloAssoProvider,
  paymentProviderLabel,
  type ClubPaymentProviderStatusDto,
  type PaymentProvider,
} from "../../../services/api/payment-provider-api";
import { styles } from "./settings.styles";

interface SettingsClubSectionProps {
  theme: AppTheme;
  registrationPolicy: string;
  handleSetRegistrationPolicy: (value: string) => Promise<void>;
  helloAssoStatus: HelloAssoStatus | null;
  /** Club payment connector (#665); null on a backend older than #388. */
  paymentProviderStatus: ClubPaymentProviderStatusDto | null;
  onSelectPaymentProvider: (provider: PaymentProvider) => Promise<void>;
  /** Opens the credentials form of the current connector (HelloAsso today). */
  onOpenHelloAsso: () => void;
}

/** Connector shown to the club: the chosen one, HelloAsso before #388. */
function currentConnector(
  paymentProviderStatus: ClubPaymentProviderStatusDto | null,
  helloAssoStatus: HelloAssoStatus | null,
): {
  /** Typed as a string: compared with connectors this build may not know. */
  provider: string;
  configured: boolean;
} {
  if (paymentProviderStatus) {
    return {
      provider: paymentProviderStatus.paymentProvider,
      configured: paymentProviderStatus.configured,
    };
  }
  return {
    provider: "HELLOASSO",
    configured: helloAssoStatus?.helloAssoConnected === true,
  };
}

export const SettingsClubSection: React.FC<SettingsClubSectionProps> = ({
  theme,
  registrationPolicy,
  handleSetRegistrationPolicy,
  helloAssoStatus,
  paymentProviderStatus,
  onSelectPaymentProvider,
  onOpenHelloAsso,
}) => {
  const connector = currentConnector(paymentProviderStatus, helloAssoStatus);
  const connectorName = paymentProviderLabel(connector.provider);
  const connectorState = connector.configured
    ? isHelloAssoProvider(connector.provider) &&
      helloAssoStatus?.organizationSlug
      ? `Configuré (${helloAssoStatus.organizationSlug})`
      : "Configuré"
    : "Non configuré — renseignez vos identifiants pour encaisser en ligne";

  return (
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

      {/* Paiement en ligne (#665): neutral section, the connector is a choice */}
      <View style={styles.sectionTitleContainer}>
        <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          Paiement en ligne
        </Text>
      </View>
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        {paymentProviderStatus &&
          canChoosePaymentProvider(paymentProviderStatus) && (
            <View style={styles.policyContainer}>
              <View style={styles.gap12}>
                {paymentProviderStatus.selectableProviders.map((provider) => {
                  const selected = provider === connector.provider;
                  const label = paymentProviderLabel(provider);
                  return (
                    <TouchableOpacity
                      key={provider}
                      style={[
                        styles.policyOption,
                        selected
                          ? {
                              borderColor: theme.primary,
                              backgroundColor: `${theme.primary}10`,
                            }
                          : { borderColor: theme.border },
                      ]}
                      onPress={() => {
                        onSelectPaymentProvider(provider).catch(() => {});
                      }}
                      testID={`settings-payment-provider-${provider}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`Connecteur de paiement : ${label}`}
                      accessibilityHint={`Encaisse les paiements en ligne du club avec ${label}`}
                    >
                      <View
                        style={[
                          styles.radioCircle,
                          {
                            borderColor: selected
                              ? theme.primary
                              : theme.textSecondary,
                          },
                        ]}
                      >
                        {selected && (
                          <View
                            style={[
                              styles.radioDot,
                              { backgroundColor: theme.primary },
                            ]}
                          />
                        )}
                      </View>
                      <View style={styles.flex1}>
                        <Text
                          style={[styles.policyLabel, { color: theme.text }]}
                        >
                          {label}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        <TouchableOpacity
          style={styles.row}
          onPress={onOpenHelloAsso}
          disabled={!isHelloAssoProvider(connector.provider)}
          testID="settings-helloasso-button"
          accessibilityRole="button"
          accessibilityLabel={`Connecteur de paiement : ${connectorName}, ${connector.configured ? "configuré" : "non configuré"}`}
          accessibilityHint={`Ouvre la saisie des identifiants ${connectorName} du club`}
        >
          <View style={styles.rowLeft}>
            <View style={[styles.iconBox, styles.helloAssoIconBox]}>
              <CreditCard size={20} color="#00B894" />
            </View>
            <View style={styles.flex1}>
              <Text style={[styles.rowLabel, { color: theme.text }]}>
                {connectorName}
              </Text>
              <Text
                testID="settings-payment-provider-state"
                style={[styles.rowSubtext, { color: theme.textSecondary }]}
              >
                {connectorState}
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
};
