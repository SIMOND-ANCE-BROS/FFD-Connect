import React from "react";
import { Alert, View } from "react-native";
import { AppButton } from "../../../../components/AppButton";
import { AppText } from "../../../../components/AppText";
import type { AppTheme } from "../../../../context/ThemeContext";
import type { Event } from "../../context/CompetitionContext";
import { getEligibilityReasonLabel, styles } from "./competition-detail.styles";
import { formatDiscipline } from "../../../../utils/discipline";

interface CompetitionEventCardProps {
  currentTheme: AppTheme;
  event: Event;
  isRegistered: boolean;
  eligibility: { eligible: boolean; reason?: string };
  isOrganizer: boolean;
  canSelfRegister: boolean | undefined;
  /** Affiche le bouton « Résultats » à la place de l'UI d'inscription (PAST + LIVE). */
  showResults: boolean;
  onNavigateResults: () => void;
  onRegister: (event: Event) => void;
  onUnregister: (event: Event) => void;
  /** Action queued offline for this event, waiting for the network (#416). */
  pendingAction?: "register" | "unregister";
}

export function CompetitionEventCard({
  currentTheme,
  event,
  isRegistered,
  eligibility,
  isOrganizer,
  canSelfRegister,
  showResults,
  onNavigateResults,
  onRegister,
  onUnregister,
  pendingAction,
}: CompetitionEventCardProps) {
  const showLicenceActions = !isOrganizer;

  return (
    <View
      style={[
        styles.eventCard,
        { backgroundColor: currentTheme.surface },
        !eligibility.eligible && showLicenceActions && styles.disabledEvent,
      ]}
    >
      <View style={styles.eventCardBody}>
        <View style={styles.eventInfo}>
          <AppText variant="h3" color={currentTheme.text}>
            {formatDiscipline(event.category)}
          </AppText>
          <AppText
            variant="caption"
            color={currentTheme.textSecondary}
            style={styles.eventDetails}
          >
            {event.dance && `${event.dance} • `}
            {event.ageGroup}
            {event.eventType === "SOLO" ? " • Solo" : " • Couple"}
          </AppText>
          {pendingAction && showLicenceActions && (
            <AppText
              testID={`pending-event-${event.id}`}
              variant="caption"
              color={currentTheme.warning}
              weight="600"
            >
              {pendingAction === "register"
                ? "Inscription en attente de réseau"
                : "Désinscription en attente de réseau"}
            </AppText>
          )}
          {!eligibility.eligible && showLicenceActions && (
            <View style={styles.notEligibleBadge}>
              <AppText
                variant="caption"
                color={currentTheme.danger}
                weight="600"
              >
                Non éligible
              </AppText>
              {eligibility.reason && (
                <AppText
                  variant="caption"
                  color={currentTheme.textSecondary}
                  style={styles.notEligibleReason}
                >
                  {getEligibilityReasonLabel(eligibility.reason)}
                </AppText>
              )}
            </View>
          )}
        </View>

        <View style={styles.eventActionsColumn}>
          {showResults ? (
            <AppButton
              title="Résultats"
              onPress={onNavigateResults}
              variant="primary"
              style={styles.compactActionButtonFromApp}
            />
          ) : (
            <>
              <AppButton
                title="Inscrits"
                variant="outline"
                style={styles.compactActionButtonFromApp}
                onPress={() =>
                  Alert.alert(
                    "Inscrits",
                    "La liste des inscrits sera bientôt disponible.",
                  )
                }
                accessibilityLabel="Voir la liste des inscrits à cette épreuve"
                accessibilityHint="Affiche les participants inscrits à cette épreuve"
              />

              {isOrganizer && (
                <AppButton
                  title="Inscrire"
                  onPress={() => {
                    onRegister(event);
                  }}
                  variant="outline"
                  style={styles.compactActionButtonFromApp}
                />
              )}

              {showLicenceActions && isRegistered && (
                <AppButton
                  testID={`unregister-event-${event.id}`}
                  title="Désinscrire"
                  onPress={() => {
                    onUnregister(event);
                  }}
                  variant="outline"
                  style={styles.compactActionButtonFromApp}
                />
              )}
              {showLicenceActions &&
                !isRegistered &&
                eligibility.eligible &&
                canSelfRegister !== false && (
                  <AppButton
                    testID={`register-event-${event.id}`}
                    title="S'inscrire"
                    onPress={() => {
                      onRegister(event);
                    }}
                    variant="primary"
                    style={styles.compactActionButtonFromApp}
                  />
                )}
              {showLicenceActions &&
                !isRegistered &&
                eligibility.eligible &&
                canSelfRegister === false && (
                  <AppText
                    variant="caption"
                    style={[
                      styles.italicCenter,
                      { color: currentTheme.textSecondary },
                    ]}
                  >
                    Inscription par le club
                  </AppText>
                )}
            </>
          )}
        </View>
      </View>
    </View>
  );
}
