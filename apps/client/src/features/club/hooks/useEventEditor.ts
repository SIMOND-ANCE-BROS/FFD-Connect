import { useEffect, useState } from "react";
import { Alert } from "react-native";
import {
  AGES_COUPLE,
  AGES_SOLO,
  ALLOWED_EVENT_KINDS_BY_COMPETITION_TYPE,
  COMPETITION_LEVELS,
  LEVELS_FOR_PROXIMITE_CLASSIFICATRICE,
  SOLO_TEAM_AGE_GROUPS,
  SOLO_TEAM_LEVELS,
  type CompetitionType,
  type EventItem,
  type EventKind,
  type MajorSubType,
} from "./useClubCompetitionEditorLogic.types";

interface UseEventEditorParams {
  competitionType: CompetitionType;
  initialEvents?: EventItem[];
  majorSubType: MajorSubType | null;
  setMajorSubType: (value: MajorSubType | null) => void;
}

export const useEventEditor = ({
  competitionType,
  initialEvents,
  majorSubType,
  setMajorSubType,
}: UseEventEditorParams) => {
  // --- EVENTS STATE ---
  const [events, setEvents] = useState<EventItem[]>(
    initialEvents ?? [
      {
        id: "1",
        type: "Couple",
        category: "Latine",
        ageGroup: "Adulte",
        kind: "CLASSIFICATRICE",
      },
      {
        id: "2",
        type: "Solo",
        category: "Standard",
        ageGroup: "Junior I",
        kind: "OPEN",
      },
    ],
  );
  const [showEventModal, setShowEventModal] = useState(false);

  // Event Form
  const [newEventCategory, setNewEventCategory] = useState("Latine");
  const [newEventType, setNewEventType] = useState<"Couple" | "Solo">("Couple");
  const [newEventAge, setNewEventAge] = useState("Adulte");
  const [newEventKind, setNewEventKind] =
    useState<EventKind>("CLASSIFICATRICE");
  const [newEventLevel, setNewEventLevel] = useState<string>("Intermédiaire");
  /** Pour Open : sélection multiple de catégories d'âge. */
  const [newEventAgeGroups, setNewEventAgeGroups] = useState<string[]>([
    "Adulte",
  ]);
  /** Pour Open : restriction par niveaux (vide = tous niveaux). */
  const [newEventOpenLevels, setNewEventOpenLevels] = useState<string[]>([]);

  // --- COMPUTED ---
  const allowedEventKindsForCurrentCompetition =
    ALLOWED_EVENT_KINDS_BY_COMPETITION_TYPE[competitionType];

  const levelOptionsForClassificatrice =
    competitionType === "PROXIMITE"
      ? [...LEVELS_FOR_PROXIMITE_CLASSIFICATRICE]
      : [...COMPETITION_LEVELS];

  /** Pour Solo Team : catégories d'âge équipe. Pour Open/Couple/Solo : selon type et catégorie. */
  const ageOptionsForNewEvent =
    newEventKind === "SOLO_TEAM"
      ? [...SOLO_TEAM_AGE_GROUPS]
      : newEventKind === "SHOW_DANSE"
        ? newEventCategory === "Standard"
          ? AGES_COUPLE
          : AGES_COUPLE.filter((age) => age !== "Senior V")
        : newEventType === "Solo"
          ? AGES_SOLO
          : newEventCategory === "Standard"
            ? AGES_COUPLE
            : AGES_COUPLE.filter((age) => age !== "Senior V");

  /** Pour Solo Team : uniquement Débutant / Intermédiaire. Pour Classificatrice : selon compétition. */
  const levelOptionsForNewEvent =
    newEventKind === "SOLO_TEAM"
      ? [...SOLO_TEAM_LEVELS]
      : newEventKind === "CLASSIFICATRICE"
        ? levelOptionsForClassificatrice
        : [];

  // --- EFFECTS ---
  useEffect(() => {
    if (competitionType !== "MAJEURE") {
      setMajorSubType(null);
    }
    if (!allowedEventKindsForCurrentCompetition.includes(newEventKind)) {
      setNewEventKind(
        allowedEventKindsForCurrentCompetition[0] ?? "CLASSIFICATRICE",
      );
    }
    if (
      newEventKind === "CLASSIFICATRICE" &&
      competitionType === "PROXIMITE" &&
      !LEVELS_FOR_PROXIMITE_CLASSIFICATRICE.includes(
        newEventLevel as "Débutant" | "Intermédiaire",
      )
    ) {
      setNewEventLevel("Intermédiaire");
    }
    if (newEventKind === "SOLO_TEAM") {
      if (
        !SOLO_TEAM_LEVELS.includes(
          newEventLevel as "Débutant" | "Intermédiaire",
        )
      ) {
        setNewEventLevel("Intermédiaire");
      }
      if (
        !SOLO_TEAM_AGE_GROUPS.includes(
          newEventAge as (typeof SOLO_TEAM_AGE_GROUPS)[number],
        )
      ) {
        setNewEventAge("Adulte");
      }
    }
    if (newEventKind === "OPEN") {
      if (newEventAgeGroups.length === 0) setNewEventAgeGroups([newEventAge]);
    } else {
      setNewEventOpenLevels([]);
    }
  }, [
    competitionType,
    allowedEventKindsForCurrentCompetition,
    newEventKind,
    newEventLevel,
    newEventAge,
    newEventAgeGroups.length,
  ]);

  // --- ACTIONS ---
  const addEvent = () => {
    const openAges =
      newEventKind === "OPEN"
        ? newEventAgeGroups.filter((a) => ageOptionsForNewEvent.includes(a))
        : [];
    if (newEventKind === "OPEN" && openAges.length === 0) {
      Alert.alert(
        "Erreur",
        "Veuillez sélectionner au moins une catégorie d'âge pour l'épreuve Open.",
      );
      return;
    }
    const level =
      newEventKind === "CLASSIFICATRICE" || newEventKind === "SOLO_TEAM"
        ? levelOptionsForNewEvent.includes(newEventLevel as never)
          ? newEventLevel
          : levelOptionsForNewEvent[0]
        : undefined;

    const type =
      newEventKind === "SHOW_DANSE"
        ? "Couple"
        : newEventKind === "SOLO_TEAM"
          ? "Solo"
          : newEventType;
    const category =
      newEventKind === "SOLO_TEAM" ? "Solo Team" : newEventCategory;
    const ageGroup =
      newEventKind === "OPEN" ? (openAges[0] ?? newEventAge) : newEventAge;
    const ageGroups =
      newEventKind === "OPEN" && openAges.length > 0 ? openAges : undefined;
    const openLevels =
      newEventKind === "OPEN" && newEventOpenLevels.length > 0
        ? [...newEventOpenLevels]
        : undefined;

    const newEvent: EventItem = {
      id: Date.now().toString(),
      type,
      category,
      ageGroup,
      ...(ageGroups ? { ageGroups } : {}),
      ...(openLevels ? { openLevels } : {}),
      kind: newEventKind,
      level,
    };
    setEvents([...events, newEvent]);
    setShowEventModal(false);
  };

  const toggleOpenAgeGroup = (age: string) => {
    setNewEventAgeGroups((prev) =>
      prev.includes(age) ? prev.filter((a) => a !== age) : [...prev, age],
    );
  };

  const toggleOpenLevel = (level: string) => {
    setNewEventOpenLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level],
    );
  };

  const removeEvent = (id: string) =>
    setEvents(events.filter((e) => e.id !== id));

  return {
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
    levelOptionsForClassificatrice,
    levelOptionsForNewEvent,
    ageOptionsForNewEvent,
    newEventAgeGroups,
    toggleOpenAgeGroup,
    newEventOpenLevels,
    toggleOpenLevel,
    majorSubType,
    setMajorSubType,
    addEvent,
    removeEvent,
  };
};
