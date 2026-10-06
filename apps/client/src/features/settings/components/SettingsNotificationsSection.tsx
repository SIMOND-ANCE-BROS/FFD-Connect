import { BellRing } from "lucide-react-native";
import React from "react";
import { ActivityIndicator, Switch, Text, View } from "react-native";
import { AppTheme } from "../../../context/ThemeContext";
import type { NotificationPreference } from "../../../services/api/notification-api";
import { styles } from "./settings.styles";

interface SettingsNotificationsSectionProps {
  theme: AppTheme;
  preferences: NotificationPreference[];
  loading: boolean;
  /** Types dont la bascule est en vol : l'interrupteur concerné est figé. */
  pending: string[];
  error: string | null;
  onToggle: (type: string, enabled: boolean) => void;
}

/**
 * Section « Notifications » (#37) : un interrupteur par type d'événement.
 *
 * La liste vient entièrement du serveur — libellés compris. Le composant ne
 * connaît aucun type et n'en teste aucun, ce qui permet d'en ajouter côté
 * backend sans toucher au client.
 *
 * Couper un type n'arrête que la notification push : l'événement continue
 * d'alimenter la cloche in-app. C'est dit à l'utilisateur sous le titre, parce
 * que l'inverse serait une attente raisonnable.
 */
export const SettingsNotificationsSection: React.FC<
  SettingsNotificationsSectionProps
> = ({ theme, preferences, loading, pending, error, onToggle }) => (
  <>
    <View style={styles.sectionTitleContainer}>
      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
        Notifications
      </Text>
    </View>

    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      <View style={styles.row}>
        <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>
          Désactiver un type coupe seulement l&apos;alerte sur votre téléphone.
          L&apos;événement reste consultable dans la cloche.
        </Text>
      </View>

      {loading && preferences.length === 0 ? (
        <View style={styles.row} testID="notification-preferences-loading">
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : null}

      {error ? (
        <View style={styles.row}>
          <Text style={[styles.rowLabel, { color: theme.danger }]}>
            {error}
          </Text>
        </View>
      ) : null}

      {preferences.map((preference) => (
        <View
          key={preference.type}
          style={[
            styles.row,
            styles.borderTop,
            { borderTopColor: theme.border },
          ]}
        >
          <View style={[styles.rowLeft, styles.rowLeftFlexible]}>
            <View style={[styles.iconBox, { backgroundColor: "#9747FF20" }]}>
              <BellRing size={18} color="#9747FF" />
            </View>
            <View style={styles.rowTextContent}>
              <Text style={[styles.rowLabel, { color: theme.text }]}>
                {/* Repli sur le type brut : un libellé manquant ne doit pas
                    produire une ligne vide et intoggleable. */}
                {preference.label || preference.type}
              </Text>
              {preference.description ? (
                <Text
                  style={[styles.rowSubtext, { color: theme.textSecondary }]}
                >
                  {preference.description}
                </Text>
              ) : null}
            </View>
          </View>
          <Switch
            trackColor={{ false: "#767577", true: theme.primary }}
            thumbColor={preference.enabled ? "#fff" : "#f4f3f4"}
            ios_backgroundColor="#3e3e3e"
            value={preference.enabled}
            disabled={pending.includes(preference.type)}
            onValueChange={(value) => onToggle(preference.type, value)}
            testID={`notification-preference-${preference.type}`}
            accessibilityLabel={preference.label || preference.type}
            accessibilityHint={
              preference.enabled
                ? "Désactive les notifications push de ce type"
                : "Active les notifications push de ce type"
            }
          />
        </View>
      ))}
    </View>
  </>
);
