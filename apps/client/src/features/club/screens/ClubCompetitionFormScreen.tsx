import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { X } from "lucide-react-native";
import React from "react";
import { TouchableOpacity, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { FluidSegmentedTab } from "../../../components/FluidSegmentedTab";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import { CompetitionEventsTab } from "../components/editor/CompetitionEventsTab";
import { CompetitionGeneralTab } from "../components/editor/CompetitionGeneralTab";
import { CompetitionOrganisationTab } from "../components/editor/CompetitionOrganisationTab";
import { CompetitionTimingTab } from "../components/editor/CompetitionTimingTab";
import { styles } from "../components/editor/competition-editor.styles";
import { useClubCompetitionEditorLogic } from "../hooks/useClubCompetitionEditorLogic";

type EditorTab = "GENERAL" | "EVENTS" | "TIMING" | "ORGANISATION";

type Props = NativeStackScreenProps<
  RootStackParamList,
  "ClubCompetitionEditor"
>;

export const ClubCompetitionFormScreen: React.FC<Props> = ({
  navigation,
  route,
}) => {
  const { theme } = useTheme();

  const {
    isEditing,
    kind,
    setKind,
    activeTab,
    setActiveTab,
    // General
    title,
    setTitle,
    status,
    setStatus,
    date,
    showDatePicker,
    setShowDatePicker,
    dateText,
    location,
    setLocation,
    competitionType,
    setCompetitionType,
    majorSubType,
    setMajorSubType,
    // Events
    events,
    showEventModal,
    setShowEventModal,
    newEventCategory,
    setNewEventCategory,
    newEventType,
    setNewEventType,
    newEventAge,
    setNewEventAge,
    newEventKind,
    setNewEventKind,
    newEventLevel,
    setNewEventLevel,
    allowedEventKindsForCurrentCompetition,
    levelOptionsForNewEvent,
    ageOptionsForNewEvent,
    newEventAgeGroups,
    toggleOpenAgeGroup,
    newEventOpenLevels,
    toggleOpenLevel,
    // Timing
    schedule,
    showTimingModal,
    setShowTimingModal,
    newTime,
    showTimePicker,
    setShowTimePicker,
    newTimeText,
    newTimingType,
    setNewTimingType,
    newTimingTitle,
    setNewTimingTitle,
    newTimingDuration,
    setNewTimingDuration,
    editingTimingId,
    // Actions
    handleSave,
    onDateChange,
    onTimeChange,
    addEvent,
    removeEvent,
    openTimingModal,
    saveTiming,
    removeTiming,
    handleDragEnd,
    // Organisation
    volunteerToken,
    setVolunteerToken,
    isGeneratingToken,
    handleGenerateVolunteerToken,
    // Programme
    eventsDescription,
    setEventsDescription,
    // Ticketing & Layout
    ticketingUrl,
    setTicketingUrl,
    layoutItems,
    showLayoutModal,
    setShowLayoutModal,
    newLayoutType,
    setNewLayoutType,
    newLayoutLabel,
    setNewLayoutLabel,
    newLayoutCapacity,
    setNewLayoutCapacity,
    newLayoutRows,
    setNewLayoutRows,
    newLayoutCols,
    setNewLayoutCols,
    newLayoutX,
    setNewLayoutX,
    newLayoutY,
    setNewLayoutY,
    newLayoutWidth,
    setNewLayoutWidth,
    newLayoutHeight,
    setNewLayoutHeight,
    newLayoutRotation,
    setNewLayoutRotation,
    openLayoutModal,
    updateLayoutItemPosition,
    toggleLayoutItemSeatLock,
    cycleLayoutItemOrientation,
    editingLayoutItem,
    addLayoutItem,
    removeLayoutItem,
    duplicateLayoutItem,
  } = useClubCompetitionEditorLogic({
    initialCompetition: route.params?.competition as unknown as Parameters<
      typeof useClubCompetitionEditorLogic
    >[0]["initialCompetition"],
    navigation,
  });

  const isEvent = kind === "EVENT";

  const handleKindChange = (val: string) => {
    const nextKind = val === "EVENT" ? "EVENT" : "COMPETITION";
    // Un événement n'a que les onglets Général + Organisation.
    if (
      nextKind === "EVENT" &&
      (activeTab === "EVENTS" || activeTab === "TIMING")
    ) {
      setActiveTab("GENERAL");
    }
    setKind(nextKind);
  };

  return (
    <GestureHandlerRootView style={styles.flex1}>
      <SafeAreaView
        style={[styles.container, { backgroundColor: theme.background }]}
        edges={["bottom"]}
      >
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => navigation.goBack()}
            style={styles.closeButton}
          >
            <X size={24} color={theme.text} />
          </TouchableOpacity>
          <AppText variant="h3" style={{ color: theme.text }}>
            {isEditing
              ? "Modifier"
              : isEvent
                ? "Nouvel Événement"
                : "Nouvelle Compétition"}
          </AppText>
          <View style={styles.w40} />
        </View>

        <View style={styles.padding16}>
          <FluidSegmentedTab
            activeValue={kind}
            testID="competition-editor-kind-tabs"
            onChange={handleKindChange}
            options={[
              { label: "Compétition", value: "COMPETITION" },
              { label: "Événement", value: "EVENT" },
            ]}
          />
        </View>

        <View style={[styles.padding16, styles.pt0]}>
          <FluidSegmentedTab
            activeValue={activeTab}
            testID="competition-editor-tabs"
            onChange={(val) => setActiveTab(val as EditorTab)}
            options={
              isEvent
                ? [
                    { label: "Général", value: "GENERAL" },
                    { label: "Organisation", value: "ORGANISATION" },
                  ]
                : [
                    { label: "Général", value: "GENERAL" },
                    { label: "Épreuves", value: "EVENTS" },
                    { label: "Planning", value: "TIMING" },
                    { label: "Organisation", value: "ORGANISATION" },
                  ]
            }
          />
        </View>

        <View style={styles.flex1}>
          {activeTab === "GENERAL" && (
            <CompetitionGeneralTab
              theme={theme}
              isEvent={isEvent}
              status={status}
              setStatus={setStatus}
              competitionType={competitionType}
              setCompetitionType={setCompetitionType}
              majorSubType={majorSubType}
              setMajorSubType={setMajorSubType}
              title={title}
              setTitle={setTitle}
              date={date}
              showDatePicker={showDatePicker}
              setShowDatePicker={setShowDatePicker}
              dateText={dateText}
              onDateChange={onDateChange}
              location={location}
              setLocation={setLocation}
              eventsDescription={eventsDescription}
              setEventsDescription={setEventsDescription}
            />
          )}
          {!isEvent && activeTab === "EVENTS" && (
            <CompetitionEventsTab
              theme={theme}
              competitionType={competitionType}
              events={events}
              removeEvent={removeEvent}
              showEventModal={showEventModal}
              setShowEventModal={setShowEventModal}
              newEventKind={newEventKind}
              setNewEventKind={setNewEventKind}
              newEventType={newEventType}
              setNewEventType={setNewEventType}
              newEventCategory={newEventCategory}
              setNewEventCategory={setNewEventCategory}
              newEventAge={newEventAge}
              setNewEventAge={setNewEventAge}
              newEventLevel={newEventLevel}
              setNewEventLevel={setNewEventLevel}
              newEventAgeGroups={newEventAgeGroups}
              toggleOpenAgeGroup={toggleOpenAgeGroup}
              newEventOpenLevels={newEventOpenLevels}
              toggleOpenLevel={toggleOpenLevel}
              allowedEventKindsForCurrentCompetition={
                allowedEventKindsForCurrentCompetition
              }
              levelOptionsForNewEvent={levelOptionsForNewEvent}
              ageOptionsForNewEvent={ageOptionsForNewEvent}
              addEvent={addEvent}
            />
          )}
          {!isEvent && activeTab === "TIMING" && (
            <CompetitionTimingTab
              theme={theme}
              schedule={schedule}
              handleDragEnd={handleDragEnd}
              showTimingModal={showTimingModal}
              setShowTimingModal={setShowTimingModal}
              newTime={newTime}
              showTimePicker={showTimePicker}
              setShowTimePicker={setShowTimePicker}
              newTimeText={newTimeText}
              onTimeChange={onTimeChange}
              newTimingType={newTimingType}
              setNewTimingType={setNewTimingType}
              newTimingTitle={newTimingTitle}
              setNewTimingTitle={setNewTimingTitle}
              newTimingDuration={newTimingDuration}
              setNewTimingDuration={setNewTimingDuration}
              editingTimingId={editingTimingId}
              openTimingModal={openTimingModal}
              saveTiming={saveTiming}
              removeTiming={removeTiming}
            />
          )}
          {activeTab === "ORGANISATION" && (
            <CompetitionOrganisationTab
              theme={theme}
              volunteerToken={volunteerToken}
              setVolunteerToken={setVolunteerToken}
              isGeneratingToken={isGeneratingToken}
              handleGenerateVolunteerToken={handleGenerateVolunteerToken}
              ticketingUrl={ticketingUrl}
              setTicketingUrl={setTicketingUrl}
              layoutItems={layoutItems}
              showLayoutModal={showLayoutModal}
              setShowLayoutModal={setShowLayoutModal}
              newLayoutType={newLayoutType}
              setNewLayoutType={setNewLayoutType}
              newLayoutLabel={newLayoutLabel}
              setNewLayoutLabel={setNewLayoutLabel}
              newLayoutCapacity={newLayoutCapacity}
              setNewLayoutCapacity={setNewLayoutCapacity}
              newLayoutRows={newLayoutRows}
              setNewLayoutRows={setNewLayoutRows}
              newLayoutCols={newLayoutCols}
              setNewLayoutCols={setNewLayoutCols}
              newLayoutX={newLayoutX}
              setNewLayoutX={setNewLayoutX}
              newLayoutY={newLayoutY}
              setNewLayoutY={setNewLayoutY}
              newLayoutWidth={newLayoutWidth}
              setNewLayoutWidth={setNewLayoutWidth}
              newLayoutHeight={newLayoutHeight}
              setNewLayoutHeight={setNewLayoutHeight}
              newLayoutRotation={newLayoutRotation}
              setNewLayoutRotation={setNewLayoutRotation}
              openLayoutModal={openLayoutModal}
              updateLayoutItemPosition={updateLayoutItemPosition}
              toggleLayoutItemSeatLock={toggleLayoutItemSeatLock}
              cycleLayoutItemOrientation={cycleLayoutItemOrientation}
              editingLayoutItem={editingLayoutItem}
              addLayoutItem={addLayoutItem}
              removeLayoutItem={removeLayoutItem}
              duplicateLayoutItem={duplicateLayoutItem}
            />
          )}
        </View>

        <View
          style={[
            styles.footer,
            { borderTopColor: theme.border, backgroundColor: theme.surface },
          ]}
        >
          <AppButton
            title={
              activeTab === "TIMING" ? "Sauvegarder le planning" : "Enregistrer"
            }
            testID="competition-editor-save-button"
            onPress={() => {
              handleSave().catch(() => {});
            }}
            variant="primary"
            style={styles.fullWidth}
          />
        </View>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
};
