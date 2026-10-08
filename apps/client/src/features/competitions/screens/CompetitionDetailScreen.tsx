import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Calendar as CalendarIcon } from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { AppText } from "../../../components/AppText";
import { BackButton } from "../../../components/BackButton";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { FluidSegmentedTab } from "../../../components/FluidSegmentedTab";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import { analytics } from "../../../services/analytics";
import { ClubEventRegistrationModal } from "../../club/components/ClubEventRegistrationModal";
import { ClubService } from "../../club/services/ClubService";
import { CompetitionEventCard } from "../components/detail/CompetitionEventCard";
import { CompetitionInfoCard } from "../components/detail/CompetitionInfoCard";
import { CompetitionMapCard } from "../components/detail/CompetitionMapCard";
import { CompetitionPendingSection } from "../components/detail/CompetitionPendingSection";
import { CompetitionProgramSection } from "../components/detail/CompetitionProgramSection";
import { PartnerInputModal } from "../components/detail/PartnerInputModal";
import { styles } from "../components/detail/competition-detail.styles";
import { TimingList } from "../components/TimingList";
import { useCompetitionDetailLogic } from "../hooks/useCompetitionDetailLogic";
import { addCompetitionToCalendar } from "../utils/addToCalendar";
import {
  clearDeadlineStorage,
  deadlineStorageKey,
  scheduleDeadlineNotification,
} from "../../../utils/scheduleDeadlineNotification";

type Tab = "EVENTS" | "TIMING";

type Props = NativeStackScreenProps<RootStackParamList, "CompetitionDetail">;

/** Top margin of the first card (`infoCard` in competition-detail.styles). */
const FIRST_CARD_TOP_MARGIN = 16;

export const CompetitionDetailScreen = ({ route, navigation }: Props) => {
  const { competitionId } = route.params;
  const { state, actions } = useCompetitionDetailLogic(
    competitionId,
    navigation,
  );
  const [activeTab, setActiveTab] = useState<Tab>("EVENTS");
  const { theme: currentTheme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(insets.top + 56);

  useEffect(() => {
    if (state.details?.id) {
      analytics.logEvent("competition_view", {
        competition_id: state.details.id,
      });
    }
  }, [state.details?.id]);

  // Feature 3: schedule local notification for registration deadline
  const deadlineScheduled = useRef(false);
  useEffect(() => {
    if (deadlineScheduled.current) return;
    const details = state.details;
    if (!details?.id || !details.registrationDeadline) return;

    const deadline = new Date(details.registrationDeadline);
    const threeDaysBefore = new Date(
      deadline.getTime() - 3 * 24 * 60 * 60 * 1000,
    );
    if (threeDaysBefore <= new Date()) {
      // Deadline passée ou trop proche : le rappel a sonné ou ne sonnera
      // jamais — purge la clé de planification devenue obsolète (#300).
      void clearDeadlineStorage(details.id);
      return;
    }

    deadlineScheduled.current = true;
    const storageKey = deadlineStorageKey(details.id);

    void (async () => {
      try {
        const existing = await AsyncStorage.getItem(storageKey);
        if (existing) return; // already scheduled

        const notifId = await scheduleDeadlineNotification(
          details.id,
          details.title,
          details.registrationDeadline!,
        );
        if (notifId) {
          await AsyncStorage.setItem(storageKey, notifId);
        }
      } catch {
        // Silently ignore — notification is best-effort
      }
    })();
  }, [state.details]);

  const [addingCalendar, setAddingCalendar] = useState(false);
  const handleAddToCalendar = async () => {
    if (!state.details || addingCalendar) return;
    setAddingCalendar(true);
    try {
      await addCompetitionToCalendar(state.details);
    } finally {
      setAddingCalendar(false);
    }
  };

  const renderHeader = () => (
    <PinnedHeader
      theme={currentTheme}
      isDark={isDark}
      title={state.details?.title ?? "Compétition"}
      onHeightChange={setHeaderH}
      left={<BackButton onPress={() => navigation.goBack()} />}
      right={
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Ajouter au calendrier"
          accessibilityHint="Ajoute cette compétition à votre calendrier"
          disabled={addingCalendar}
          onPress={() => {
            handleAddToCalendar().catch(() => {});
          }}
          style={[
            styles.circleButton,
            {
              borderColor: currentTheme.border,
              backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#F5F5F5",
              opacity: addingCalendar ? 0.5 : 1,
            },
          ]}
          testID="competition-detail-calendar-button"
        >
          {addingCalendar ? (
            <ActivityIndicator size="small" color={currentTheme.primary} />
          ) : (
            <CalendarIcon color={currentTheme.primary} size={22} />
          )}
        </TouchableOpacity>
      }
    />
  );

  if (state.loading || !state.details) {
    return (
      <SafeAreaView style={styles.flexOne} edges={["left", "right"]}>
        <View
          style={[
            styles.mainContainer,
            { backgroundColor: currentTheme.background },
          ]}
        >
          <View style={[styles.loadingContainer, { paddingTop: headerH }]}>
            <ActivityIndicator
              color={currentTheme.primary}
              testID="competition-detail-loading"
            />
          </View>
          {renderHeader()}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flexOne} edges={["left", "right"]}>
      <View
        style={[
          styles.mainContainer,
          { backgroundColor: currentTheme.background },
        ]}
      >
        <ScrollView
          style={[
            styles.container,
            { backgroundColor: currentTheme.background },
          ]}
          // headerH already includes the header's fade tail and the first card
          // (CompetitionInfoCard) carries its own top margin: adding both on top
          // of headerH left a large empty band under the header.
          contentContainerStyle={{
            paddingTop: Math.max(0, headerH - FIRST_CARD_TOP_MARGIN),
          }}
          testID="competition-detail-scroll-view"
        >
          <CompetitionInfoCard
            currentTheme={currentTheme}
            details={state.details}
          />

          <CompetitionMapCard
            currentTheme={currentTheme}
            details={state.details}
          />

          {!!(state.details.delayMinutes && state.details.delayMinutes > 0) && (
            <View style={styles.delayBadgeContainer}>
              <View
                style={[
                  styles.delayBadge,
                  styles.alignSelfStart,
                  { backgroundColor: currentTheme.danger },
                ]}
              >
                <AppText variant="caption" weight="600" color="white">
                  ⚠️ Retard estimé: {state.details.delayMinutes} min
                </AppText>
              </View>
            </View>
          )}

          {/* Tabs */}
          {state.details.status !== "PAST" && (
            <View style={styles.tabContainer}>
              <FluidSegmentedTab
                options={[
                  { label: "Épreuves", value: "EVENTS" },
                  { label: "Timing", value: "TIMING" },
                ]}
                activeValue={activeTab}
                onChange={(value) => setActiveTab(value as Tab)}
                testID="competition-detail-tabs"
              />
            </View>
          )}

          {/* Inscriptions en attente (club, mode validation manuelle) */}
          {state.showPendingSection && (
            <CompetitionPendingSection
              currentTheme={currentTheme}
              pendingRegistrations={state.pendingRegistrationsForCompetition}
              handleConfirmRegistration={actions.handleConfirmRegistration}
              handleUnregisterMember={actions.handleUnregisterMember}
            />
          )}

          {/* Content */}
          {activeTab === "EVENTS" ? (
            <>
              <CompetitionProgramSection
                type={state.details.type}
                eventsDescription={state.details.eventsDescription}
                programUrl={state.details.programUrl}
                registrationUrl={state.details.registrationUrl}
                circularUrl={state.details.circularUrl}
              />
              <View
                style={styles.eventsList}
                testID="competition-detail-events-list"
              >
                {state.details.events.map((event) => {
                  const isRegistered = state.myRegistrations.includes(event.id);
                  const eligibility = actions.isEligible(event);
                  const isOrganizer = state.userRole === "CLUB";

                  return (
                    <CompetitionEventCard
                      key={event.id}
                      currentTheme={currentTheme}
                      event={event}
                      isRegistered={isRegistered}
                      eligibility={eligibility}
                      isOrganizer={isOrganizer}
                      canSelfRegister={state.canSelfRegister}
                      showResults={
                        state.details!.status === "PAST" ||
                        state.details!.status === "LIVE"
                      }
                      onNavigateResults={() =>
                        navigation.navigate("LiveResults", {
                          competitionId: state.details!.id,
                        })
                      }
                      onRegister={actions.handleRegister}
                      onUnregister={actions.handleUnregister}
                      pendingAction={state.pendingRegistrationActions[event.id]}
                    />
                  );
                })}
              </View>
            </>
          ) : (
            <View
              style={styles.timingContainer}
              testID="competition-detail-timing-list"
            >
              <TimingList
                schedule={state.details.schedule}
                myEventIds={state.myRegistrations}
                delayMinutes={state.details.delayMinutes}
              />
            </View>
          )}
        </ScrollView>
        {renderHeader()}
      </View>

      {state.selectedEventForRegistration && (
        <ClubEventRegistrationModal
          visible={state.userRole === "CLUB"}
          event={state.selectedEventForRegistration}
          onClose={() => actions.setSelectedEventForRegistration(null)}
          eligibleMembers={state.clubMembers.filter((m) => {
            const ev = state.selectedEventForRegistration;
            if (!ev) return false;
            return ClubService.checkEligibility(m, {
              category: ev.category,
              ageGroup: ev.ageGroup,
              level: ev.level ?? undefined,
              eventKind: (ev as { eventKind?: string }).eventKind,
            });
          })}
          onRegisterMembers={actions.handleRegisterMembers}
          isSaving={state.isRegisteringMembers}
        />
      )}

      {/* Modal partenaire pour inscription en couple (licencié) */}
      {state.partnerInputEvent && (
        <PartnerInputModal
          visible={!!state.partnerInputEvent}
          eventLabel={`${state.partnerInputEvent.category} ${state.partnerInputEvent.ageGroup}`}
          onConfirm={actions.handleConfirmPartnerRegistration}
          onClose={actions.clearPartnerInput}
          theme={currentTheme}
        />
      )}
    </SafeAreaView>
  );
};
