import React from "react";
import { Alert, View } from "react-native";
import { AppButton } from "../../../../components/AppButton";
import { AppText } from "../../../../components/AppText";
import type { AppTheme } from "../../../../context/ThemeContext";
import type { Event } from "../../context/CompetitionContext";
import { getEligibilityReasonLabel, styles } from "./competition-detail.styles";
import { formatDiscipline } from "../../../../utils/discipline";
import { joinA11yLabel } from "../../../../utils/a11y";

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
  /**
   * Guest (eligibility reason `GUEST`): « S'inscrire » sends them to sign in,
   * then back to this competition (#20). Without it the guest only sees
   * « Connexion requise ».
   */
  onSignInToRegister?: () => void;
  /** Action queued offline for this event, waiting for the network (#416). */
  pendingAction?: "register" | "unregister";
  /**
   * Row of a grouped card: the discipline / age class / type are in the
   * group header, the row only names what sets this event apart (level…).
   */
  variantLabel?: string;
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
  onSignInToRegister,
  pendingAction,
  variantLabel,
}: CompetitionEventCardProps) {
  const showLicenceActions = !isOrganizer;
  // A guest is not "not eligible": they just need an account first.
  const guestSignIn =
    showLicenceActions &&
    eligibility.reason === "GUEST" &&
    onSignInToRegister !== undefined;
  const embedded = variantLabel !== undefined;
  // Every row repeats the same buttons ("S'inscrire", "Inscrits"…): the
  // screen reader must say WHICH event each one acts on (RGAA 6.1).
  const eventName = joinA11yLabel([
    formatDiscipline(event.category),
    event.dance,
    event.ageGroup,
    variantLabel,
    event.eventType === "SOLO" ? "solo" : "couple",
  ]);
  const showNotEligible =
    !eligibility.eligible && showLicenceActions && !guestSignIn;

  return (
    <View
      testID={embedded ? `event-row-${event.id}` : undefined}
      style={[
        embedded
          ? styles.eventRow
          : [styles.eventCard, { backgroundColor: currentTheme.surface }],
        !eligibility.eligible &&
          showLicenceActions &&
          !guestSignIn &&
          styles.disabledEvent,
      ]}
    >
      <View style={styles.eventCardBody}>
        {/* Event description = one screen-reader stop (name, pending state,
            eligibility). Only Text inside, so grouping hides no control. */}
        <View
          style={styles.eventInfo}
          accessible
          accessibilityHint="Description de l'épreuve ; les boutons suivent"
          accessibilityLabel={joinA11yLabel([
            eventName,
            pendingAction && showLicenceActions
              ? pendingAction === "register"
                ? "inscription en attente de réseau"
                : "désinscription en attente de réseau"
              : null,
            isRegistered && showLicenceActions ? "inscrit" : null,
            showNotEligible ? "non éligible" : null,
            showNotEligible && eligibility.reason
              ? getEligibilityReasonLabel(eligibility.reason)
              : null,
          ])}
        >
          {embedded ? (
            <AppText variant="body" weight="600" color={currentTheme.text}>
              {variantLabel}
            </AppText>
          ) : (
            <>
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
            </>
          )}
          {pendingAction && showLicenceActions && (
            <AppText
              testID={`pending-event-${event.id}`}
              variant="caption"
              color={currentTheme.warningText}
              weight="600"
            >
              {pendingAction === "register"
                ? "Inscription en attente de réseau"
                : "Désinscription en attente de réseau"}
            </AppText>
          )}
          {showNotEligible && (
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
              // Same target for every row (competition-wide results), so the
              // plain "Résultats" label is unambiguous — and Maestro taps it.
              accessibilityHint="Ouvre les résultats de la compétition"
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
                accessibilityLabel={`Inscrits : ${eventName}`}
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
                  accessibilityLabel={`Inscrire des membres : ${eventName}`}
                  accessibilityHint="Choisir les membres du club à inscrire"
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
                  accessibilityLabel={`Se désinscrire : ${eventName}`}
                  accessibilityHint="Annule votre inscription à cette épreuve"
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
                    accessibilityLabel={`S'inscrire : ${eventName}`}
                    accessibilityHint="Vous inscrit à cette épreuve"
                  />
                )}
              {guestSignIn && (
                <AppButton
                  testID={`guest-register-event-${event.id}`}
                  title="S'inscrire"
                  onPress={onSignInToRegister}
                  variant="primary"
                  style={styles.compactActionButtonFromApp}
                  accessibilityLabel={`S'inscrire : ${eventName}`}
                  accessibilityHint="Connectez-vous ou créez un compte pour vous inscrire, puis revenez sur cette compétition"
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
