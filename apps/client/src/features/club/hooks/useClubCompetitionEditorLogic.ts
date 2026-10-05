import { useState } from "react";
import { Alert } from "react-native";
import { createLogger } from "../../../utils/logger";
import {
  CheckinService,
  VolunteerTokenResponse,
} from "../../license/services/CheckinService";
import { CompetitionService } from "../services/CompetitionService";
import {
  MAJOR_SUB_TYPES,
  isValidCompetitionStatus,
  type Competition,
  type CompetitionKind,
  type CompetitionStatus,
  type CompetitionType,
  type EditorTab,
  type MajorSubType,
} from "./useClubCompetitionEditorLogic.types";
import { useEventEditor } from "./useEventEditor";
import { useLayoutEditor } from "./useLayoutEditor";
import { useTimingEditor } from "./useTimingEditor";

export * from "./useClubCompetitionEditorLogic.types";

const logger = createLogger("useClubCompetitionEditorLogic");

interface UseClubCompetitionEditorLogicProps {
  initialCompetition?: Partial<Competition>;
  navigation: {
    goBack: () => void;
  };
}

export const useClubCompetitionEditorLogic = ({
  initialCompetition = {},
  navigation,
}: UseClubCompetitionEditorLogicProps) => {
  const isEditing = !!initialCompetition.id;

  // Compétition vs Événement (non compétitif). Dérivé du champ `type`.
  const [kind, setKind] = useState<CompetitionKind>(
    initialCompetition.type === "EVENT" ? "EVENT" : "COMPETITION",
  );

  // Tabs
  const [activeTab, setActiveTab] = useState<EditorTab>("GENERAL");

  // --- GENERAL STATE ---
  const [title, setTitle] = useState(initialCompetition.title ?? "");
  const [status, setStatus] = useState<CompetitionStatus>(
    initialCompetition.status &&
      isValidCompetitionStatus(initialCompetition.status)
      ? initialCompetition.status
      : "DRAFT",
  );
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateText, setDateText] = useState(initialCompetition.date ?? "");
  const [location, setLocation] = useState(initialCompetition.location ?? "");
  const [competitionType, setCompetitionType] = useState<CompetitionType>(
    // competitionType may be absent when creating a new competition, default to "PROXIMITE"
    ((initialCompetition.competitionType as string | undefined) ??
      "PROXIMITE") as CompetitionType,
  );
  const [majorSubType, setMajorSubType] = useState<MajorSubType | null>(
    ((initialCompetition.majorSubType as string | undefined) ??
      null) as MajorSubType | null,
  );

  // --- VOLUNTEER TOKEN ---
  const [volunteerToken, setVolunteerToken] =
    useState<VolunteerTokenResponse | null>(null);
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);

  // --- TICKETING ---
  const [ticketingUrl, setTicketingUrl] = useState(
    initialCompetition.ticketingUrl ?? "",
  );

  // --- PROGRAMME (texte libre, réutilise le champ `eventsDescription`) ---
  const [eventsDescription, setEventsDescription] = useState(
    initialCompetition.eventsDescription ?? "",
  );

  // --- SUB-HOOKS ---
  const eventEditor = useEventEditor({
    competitionType,
    initialEvents: initialCompetition.events,
    majorSubType,
    setMajorSubType,
  });

  const timingEditor = useTimingEditor({
    initialSchedule: initialCompetition.schedule,
  });

  const layoutEditor = useLayoutEditor({
    initialLayoutItems: initialCompetition.layout,
  });

  // --- ACTIONS ---
  const handleSave = async () => {
    if (!title || !dateText || !location) {
      Alert.alert(
        "Erreur",
        'Veuillez remplir les champs obligatoires dans "Général"',
      );
      return;
    }
    const isEvent = kind === "EVENT";

    if (
      !isEvent &&
      competitionType === "MAJEURE" &&
      (!majorSubType || !MAJOR_SUB_TYPES.includes(majorSubType))
    ) {
      Alert.alert(
        "Erreur",
        "Pour une compétition majeure, veuillez sélectionner le type (ex. Championnats régionaux, Critériums nationaux).",
      );
      return;
    }

    const payload = isEvent
      ? {
          title,
          status,
          date: dateText,
          location,
          type: kind,
          eventsDescription,
          ticketingUrl,
        }
      : {
          title,
          status,
          date: dateText,
          location,
          type: kind,
          competitionType,
          majorSubType:
            competitionType === "MAJEURE" && majorSubType ? majorSubType : null,
          events: eventEditor.events,
          schedule: timingEditor.schedule,
          eventsDescription,
          ticketingUrl,
          layout: layoutEditor.layoutItems,
        };
    logger.debug("Saving Competition:", payload);

    try {
      if (isEditing && initialCompetition.id) {
        await CompetitionService.update(
          initialCompetition.id,
          payload as Partial<Competition>,
        );
      } else {
        await CompetitionService.create(payload as Omit<Competition, "id">);
      }

      Alert.alert(
        "Succès",
        `Compétition ${isEditing ? "modifiée" : "créée"} avec succès !`,
        [{ text: "OK", onPress: () => navigation.goBack() }],
      );
    } catch (error) {
      logger.error("Error saving competition:", error);
      Alert.alert("Erreur", "Impossible de sauvegarder la compétition");
    }
  };

  const handleGenerateVolunteerToken = async () => {
    if (!initialCompetition.id) {
      Alert.alert(
        "Erreur",
        "Veuillez enregistrer la compétition avant de générer un accès.",
      );
      return;
    }
    setIsGeneratingToken(true);
    try {
      const token = await CheckinService.generateVolunteerToken(
        initialCompetition.id,
      );
      setVolunteerToken(token);
    } catch (error) {
      logger.error("Error generating volunteer token", error);
      Alert.alert("Erreur", "Impossible de générer le lien bénévole");
    } finally {
      setIsGeneratingToken(false);
    }
  };

  const onDateChange = (_event: unknown, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) {
      setDate(selectedDate);
      setDateText(
        selectedDate.toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
      );
    }
  };

  return {
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
    setDateText,
    location,
    setLocation,
    competitionType,
    setCompetitionType,
    // Actions
    handleSave,
    onDateChange,
    // Organisation
    volunteerToken,
    setVolunteerToken,
    isGeneratingToken,
    handleGenerateVolunteerToken,
    // Ticketing
    ticketingUrl,
    setTicketingUrl,
    // Programme (texte libre)
    eventsDescription,
    setEventsDescription,
    // Sub-hooks (spread to preserve API)
    ...eventEditor,
    ...timingEditor,
    ...layoutEditor,
  };
};
