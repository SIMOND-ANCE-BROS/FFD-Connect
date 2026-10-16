import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { createLogger } from "../../../utils/logger";
import {
  CheckinService,
  VolunteerTokenResponse,
} from "../../license/services/CheckinService";
import { CompetitionService } from "../services/CompetitionService";
import {
  CompetitionProgramError,
  fetchCompetitionProgram,
  saveCompetitionProgram,
} from "../services/competitionProgramApi";
import {
  buildProgramPayload,
  eventsFromProgram,
  scheduleFromProgram,
} from "./competitionProgram";
import {
  buildCompetitionPayload,
  buildCompetitionUpdatePayload,
  parseCompetitionDate,
  toApiCompetitionStatus,
  type CompetitionEditorForm,
} from "./competitionPayload";
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

const formatDisplayDate = (value: Date) =>
  value.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/**
 * Programme (« Épreuves » + « Planning ») of the competition being edited
 * (#442): `loading` while an existing competition's programme is fetched,
 * `error` when it could not be (it is then never overwritten by a save).
 */
export type ProgramStatus = "loading" | "ready" | "error";

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
  // Set once the competition exists: after a creation whose programme could
  // not be saved, the next save updates it instead of creating a duplicate.
  const [competitionId, setCompetitionId] = useState(initialCompetition.id);
  const isEditing = !!competitionId;
  const [programStatus, setProgramStatus] = useState<ProgramStatus>(
    initialCompetition.id ? "loading" : "ready",
  );
  const [syncedFromFfd, setSyncedFromFfd] = useState(false);

  // Compétition vs Événement (non compétitif). Dérivé du champ `type`.
  const [kind, setKind] = useState<CompetitionKind>(
    initialCompetition.type === "EVENT" ? "EVENT" : "COMPETITION",
  );

  // Tabs
  const [activeTab, setActiveTab] = useState<EditorTab>("GENERAL");

  // --- GENERAL STATE ---
  const [title, setTitle] = useState(initialCompetition.title ?? "");
  // Only the API statuses are offered (#417): legacy DRAFT/OPEN/CLOSED map
  // onto them so the segmented control highlights a valid choice.
  const [status, setStatus] = useState<CompetitionStatus>(
    toApiCompetitionStatus(
      initialCompetition.status &&
        isValidCompetitionStatus(initialCompetition.status)
        ? initialCompetition.status
        : "UPCOMING",
    ),
  );
  // The API wants an ISO date: keep the picked Date, the text is display only.
  // A date that isn't ISO (e.g. a display label) counts as not picked yet.
  const initialDate = parseCompetitionDate(initialCompetition.date);
  const [date, setDate] = useState(initialDate ?? new Date());
  const [hasDate, setHasDate] = useState(initialDate !== null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateText, setDateText] = useState(
    initialDate ? formatDisplayDate(initialDate) : "",
  );
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

  const { replaceEvents } = eventEditor;
  const { replaceSchedule } = timingEditor;

  // --- PROGRAMME (#442): load the stored events and schedule once ---
  useEffect(() => {
    const id = initialCompetition.id;
    if (!id) return;
    let cancelled = false;
    fetchCompetitionProgram(id)
      .then((program) => {
        if (cancelled) return;
        replaceEvents(eventsFromProgram(program));
        replaceSchedule(scheduleFromProgram(program));
        setSyncedFromFfd(program.syncedFromFfd);
        setProgramStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        logger.error("Error loading competition programme", error);
        setProgramStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // Loaded once per opened competition.
  }, [initialCompetition.id, replaceEvents, replaceSchedule]);

  // --- ACTIONS ---
  const handleSave = async () => {
    if (!title || !hasDate || !location) {
      Alert.alert(
        "Erreur",
        'Veuillez remplir les champs obligatoires dans "Général"',
      );
      return;
    }
    const isEvent = kind === "EVENT";
    if (!isEvent && programStatus === "loading") {
      Alert.alert(
        "Patientez",
        "Les épreuves et le planning sont en cours de chargement. Réessayez dans un instant.",
      );
      return;
    }

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

    const form: CompetitionEditorForm = {
      kind,
      title,
      status,
      date,
      location,
      competitionType,
      majorSubType,
      eventsDescription,
      ticketingUrl,
      layoutItems: layoutEditor.layoutItems,
    };
    logger.debug("Saving Competition:", form);

    let savedId = competitionId;
    try {
      if (savedId) {
        await CompetitionService.update(
          savedId,
          buildCompetitionUpdatePayload(form),
        );
      } else {
        savedId = (
          await CompetitionService.create(buildCompetitionPayload(form))
        ).id;
        setCompetitionId(savedId);
      }
    } catch (error) {
      logger.error("Error saving competition:", error);
      Alert.alert("Erreur", "Impossible de sauvegarder la compétition");
      return;
    }

    // The programme of a competition (not of a non-competitive event), only
    // once it is known: a programme that failed to load is left untouched.
    if (!isEvent && programStatus === "ready" && savedId) {
      try {
        const program = await saveCompetitionProgram(
          savedId,
          buildProgramPayload(eventEditor.events, timingEditor.schedule),
        );
        replaceEvents(eventsFromProgram(program));
        replaceSchedule(scheduleFromProgram(program));
      } catch (error) {
        logger.error("Error saving competition programme:", error);
        const reason =
          error instanceof CompetitionProgramError
            ? error.message
            : "Impossible d'enregistrer les épreuves et le planning";
        Alert.alert(
          "Épreuves non enregistrées",
          `La compétition est enregistrée, mais pas ses épreuves ni son planning : ${reason}`,
        );
        return;
      }
    }

    Alert.alert(
      "Succès",
      `Compétition ${isEditing ? "modifiée" : "créée"} avec succès !`,
      [{ text: "OK", onPress: () => navigation.goBack() }],
    );
  };

  const handleGenerateVolunteerToken = async () => {
    if (!competitionId) {
      Alert.alert(
        "Erreur",
        "Veuillez enregistrer la compétition avant de générer un accès.",
      );
      return;
    }
    setIsGeneratingToken(true);
    try {
      const token = await CheckinService.generateVolunteerToken(competitionId);
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
      setHasDate(true);
      setDateText(formatDisplayDate(selectedDate));
    }
  };

  return {
    competitionId,
    isEditing,
    programStatus,
    syncedFromFfd,
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
