import { Plus, Trash2 } from "lucide-react-native";
import React from "react";
import { Modal, ScrollView, TouchableOpacity, View } from "react-native";
import { AppButton } from "../../../../components/AppButton";
import { AppText } from "../../../../components/AppText";
import { FluidSegmentedTab } from "../../../../components/FluidSegmentedTab";
import { AppTheme } from "../../../../context/ThemeContext";
import {
  COMPETITION_LEVELS,
  EVENT_KIND_LABELS,
  type CompetitionType,
  type EventItem,
  type EventKind,
} from "../../hooks/useClubCompetitionEditorLogic";
import { styles } from "./competition-editor.styles";

interface Props {
  theme: AppTheme;
  competitionType: CompetitionType;
  events: EventItem[];
  removeEvent: (id: string) => void;
  showEventModal: boolean;
  setShowEventModal: (v: boolean) => void;
  newEventKind: EventKind;
  setNewEventKind: (k: EventKind) => void;
  newEventType: "Couple" | "Solo";
  setNewEventType: (t: "Couple" | "Solo") => void;
  newEventCategory: string;
  setNewEventCategory: (c: string) => void;
  newEventAge: string;
  setNewEventAge: (a: string) => void;
  newEventLevel: string;
  setNewEventLevel: (l: string) => void;
  newEventAgeGroups: string[];
  toggleOpenAgeGroup: (g: string) => void;
  newEventOpenLevels: string[];
  toggleOpenLevel: (l: string) => void;
  allowedEventKindsForCurrentCompetition: readonly EventKind[];
  levelOptionsForNewEvent: string[];
  ageOptionsForNewEvent: string[];
  addEvent: () => void;
}

export const CompetitionEventsTab: React.FC<Props> = ({
  theme,
  competitionType,
  events,
  removeEvent,
  showEventModal,
  setShowEventModal,
  newEventKind,
  setNewEventKind,
  newEventType,
  setNewEventType,
  newEventCategory,
  setNewEventCategory,
  newEventAge,
  setNewEventAge,
  newEventLevel,
  setNewEventLevel,
  newEventAgeGroups,
  toggleOpenAgeGroup,
  newEventOpenLevels,
  toggleOpenLevel,
  allowedEventKindsForCurrentCompetition,
  levelOptionsForNewEvent,
  ageOptionsForNewEvent,
  addEvent,
}) => (
  <>
    <ScrollView style={styles.scrollContent}>
      <View style={[styles.sectionHeader, styles.mb16]}>
        <AppText variant="body" style={{ color: theme.textSecondary }}>
          Définissez les catégories ouvertes à l'inscription.
        </AppText>
      </View>

      {events.map((event) => (
        <View
          key={event.id}
          style={[styles.card, { backgroundColor: theme.surface }]}
        >
          <View>
            <View style={styles.eventHeaderRow}>
              {event.type === "Solo" && event.kind !== "SOLO_TEAM" && (
                <View
                  style={[
                    styles.tagChip,
                    { backgroundColor: `${theme.primary}20` },
                  ]}
                >
                  <AppText
                    variant="caption"
                    style={[styles.fontSize10Bold, { color: theme.primary }]}
                  >
                    SOLO
                  </AppText>
                </View>
              )}
              {event.kind && (
                <View
                  style={[
                    styles.tagChip,
                    { backgroundColor: `${theme.textSecondary}18` },
                  ]}
                >
                  <AppText
                    variant="caption"
                    style={[
                      styles.fontSize10Semi,
                      { color: theme.textSecondary },
                    ]}
                  >
                    {EVENT_KIND_LABELS[event.kind]}
                  </AppText>
                </View>
              )}
              {event.kind !== "SOLO_TEAM" && (
                <AppText
                  variant="body"
                  weight="600"
                  style={{ color: theme.text }}
                >
                  {event.category}
                </AppText>
              )}
            </View>
            <AppText variant="caption" style={{ color: theme.textSecondary }}>
              {event.ageGroups?.length
                ? event.ageGroups.join(", ")
                : event.ageGroup}
              {event.kind === "CLASSIFICATRICE" && event.level
                ? ` · ${event.level}`
                : event.kind === "SOLO_TEAM" && event.level
                  ? ` · ${event.level}`
                  : event.kind === "OPEN" && event.openLevels?.length
                    ? ` · Niveaux: ${event.openLevels.join(", ")}`
                    : event.kind === "OPEN"
                      ? " · Tous niveaux"
                      : ""}
            </AppText>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            testID={`event-delete-${event.id}`}
            onPress={() => removeEvent(event.id)}
            style={styles.deleteButton}
          >
            <Trash2 size={20} color={theme.danger} />
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity
        accessibilityRole="button"
        testID="competition-editor-add-event-button"
        style={[
          styles.addButton,
          styles.dashedBorder,
          { borderColor: theme.primary },
        ]}
        onPress={() => setShowEventModal(true)}
      >
        <Plus size={24} color={theme.primary} />
        <AppText
          variant="button"
          style={[styles.ml8, { color: theme.primary }]}
        >
          Ajouter une épreuve
        </AppText>
      </TouchableOpacity>
    </ScrollView>

    {/* Add Event Modal */}
    <Modal visible={showEventModal} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalContent,
            { backgroundColor: theme.surface },
            styles.maxH80pct,
          ]}
        >
          <AppText variant="h3" style={[styles.mb16, { color: theme.text }]}>
            Ajouter une épreuve
          </AppText>

          <ScrollView>
            <View style={styles.inputGroup}>
              <AppText
                variant="caption"
                color={theme.textSecondary}
                style={styles.mb8}
              >
                Type d'épreuve
              </AppText>
              <View style={styles.chipRow}>
                {allowedEventKindsForCurrentCompetition.map(
                  (kind: EventKind) => {
                    const isSelected = newEventKind === kind;
                    const kindTextColor = {
                      color: isSelected ? "#FFF" : theme.text,
                    };
                    return (
                      <TouchableOpacity
                        key={kind}
                        accessibilityRole="button"
                        onPress={() => setNewEventKind(kind)}
                        style={[
                          styles.chip,
                          styles.chipRadius8,
                          isSelected
                            ? {
                                backgroundColor: theme.primary,
                                borderColor: theme.primary,
                              }
                            : { borderColor: theme.border },
                        ]}
                      >
                        <AppText variant="caption" style={kindTextColor}>
                          {EVENT_KIND_LABELS[kind]}
                        </AppText>
                      </TouchableOpacity>
                    );
                  },
                )}
              </View>
            </View>

            {newEventKind !== "SOLO_TEAM" && newEventKind !== "SHOW_DANSE" && (
              <View style={styles.rowInput}>
                <View style={[styles.inputGroup, styles.flex1MR8]}>
                  <AppText
                    variant="caption"
                    color={theme.textSecondary}
                    style={styles.mb8}
                  >
                    Type
                  </AppText>
                  <FluidSegmentedTab
                    activeValue={newEventType}
                    testID="event-editor-type-tabs"
                    onChange={(v: string) =>
                      setNewEventType(v as "Couple" | "Solo")
                    }
                    options={[
                      { label: "Couple", value: "Couple" },
                      { label: "Solo", value: "Solo" },
                    ]}
                  />
                </View>
                <View style={[styles.inputGroup, styles.flex1]}>
                  <AppText
                    variant="caption"
                    color={theme.textSecondary}
                    style={styles.mb8}
                  >
                    Catégorie
                  </AppText>
                  <FluidSegmentedTab
                    activeValue={newEventCategory}
                    testID="event-editor-category-tabs"
                    onChange={(v) => setNewEventCategory(v)}
                    options={[
                      { label: "Latine", value: "Latine" },
                      { label: "Standard", value: "Standard" },
                    ]}
                  />
                </View>
              </View>
            )}

            {newEventKind === "SHOW_DANSE" && (
              <View style={styles.inputGroup}>
                <AppText
                  variant="caption"
                  color={theme.textSecondary}
                  style={styles.mb8}
                >
                  Catégorie (Latine / Standard)
                </AppText>
                <FluidSegmentedTab
                  activeValue={newEventCategory}
                  onChange={(v) => setNewEventCategory(v)}
                  options={[
                    { label: "Latine", value: "Latine" },
                    { label: "Standard", value: "Standard" },
                  ]}
                />
              </View>
            )}

            <View style={styles.inputGroup}>
              <AppText
                variant="caption"
                color={theme.textSecondary}
                style={styles.mb8}
              >
                {newEventKind === "SOLO_TEAM"
                  ? "Catégorie d'âge de la team"
                  : newEventKind === "OPEN"
                    ? "Catégories d'âge (plusieurs possibles)"
                    : "Age"}
              </AppText>
              <View style={styles.chipRow}>
                {newEventKind === "OPEN"
                  ? ageOptionsForNewEvent.map((opt: string) => {
                      const isSelected = newEventAgeGroups.includes(opt);
                      const ageGroupTextColor = {
                        color: isSelected ? "#FFF" : theme.text,
                      };
                      return (
                        <TouchableOpacity
                          accessibilityRole="button"
                          key={opt}
                          onPress={() => toggleOpenAgeGroup(opt)}
                          style={[
                            styles.chip,
                            styles.chipRadius8,
                            isSelected
                              ? {
                                  backgroundColor: theme.primary,
                                  borderColor: theme.primary,
                                }
                              : { borderColor: theme.border },
                          ]}
                        >
                          <AppText variant="caption" style={ageGroupTextColor}>
                            {opt}
                          </AppText>
                        </TouchableOpacity>
                      );
                    })
                  : ageOptionsForNewEvent.map((opt: string) => {
                      const isSelected = newEventAge === opt;
                      const ageTextColor = {
                        color: isSelected ? "#FFF" : theme.text,
                      };
                      return (
                        <TouchableOpacity
                          accessibilityRole="button"
                          key={opt}
                          onPress={() => setNewEventAge(opt)}
                          style={[
                            styles.chip,
                            styles.chipRadius8,
                            isSelected
                              ? {
                                  backgroundColor: theme.primary,
                                  borderColor: theme.primary,
                                }
                              : { borderColor: theme.border },
                          ]}
                        >
                          <AppText variant="caption" style={ageTextColor}>
                            {opt}
                          </AppText>
                        </TouchableOpacity>
                      );
                    })}
              </View>
            </View>

            {newEventKind === "OPEN" && (
              <View style={styles.inputGroup}>
                <AppText
                  variant="caption"
                  color={theme.textSecondary}
                  style={styles.mb8}
                >
                  Niveaux (optionnel)
                </AppText>
                <AppText
                  variant="caption"
                  style={[styles.mb8, { color: theme.textSecondary }]}
                >
                  Regrouper des classes d'âge et/ou des niveaux. Aucune
                  sélection = tous niveaux.
                </AppText>
                <View style={styles.chipRow}>
                  {COMPETITION_LEVELS.map((level: string) => {
                    const isSelected = newEventOpenLevels.includes(level);
                    const levelTextColor = {
                      color: isSelected ? "#FFF" : theme.text,
                    };
                    return (
                      <TouchableOpacity
                        key={level}
                        accessibilityRole="button"
                        onPress={() => toggleOpenLevel(level)}
                        style={[
                          styles.chip,
                          styles.chipRadius8,
                          isSelected
                            ? {
                                backgroundColor: theme.primary,
                                borderColor: theme.primary,
                              }
                            : { borderColor: theme.border },
                        ]}
                      >
                        <AppText variant="caption" style={levelTextColor}>
                          {level}
                        </AppText>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {(newEventKind === "CLASSIFICATRICE" ||
              newEventKind === "SOLO_TEAM") && (
              <View style={styles.inputGroup}>
                <AppText
                  variant="caption"
                  color={theme.textSecondary}
                  style={styles.mb8}
                >
                  Niveau
                </AppText>
                <View style={styles.chipRow}>
                  {levelOptionsForNewEvent.map((level: string) => {
                    const isSelected = newEventLevel === level;
                    const lvlTextColor = {
                      color: isSelected ? "#FFF" : theme.text,
                    };
                    return (
                      <TouchableOpacity
                        key={level}
                        accessibilityRole="button"
                        onPress={() => setNewEventLevel(level)}
                        style={[
                          styles.chip,
                          styles.chipRadius8,
                          isSelected
                            ? {
                                backgroundColor: theme.primary,
                                borderColor: theme.primary,
                              }
                            : { borderColor: theme.border },
                        ]}
                      >
                        <AppText variant="caption" style={lvlTextColor}>
                          {level}
                        </AppText>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {newEventKind === "SOLO_TEAM" && (
                  <AppText
                    variant="caption"
                    style={[styles.mt6, { color: theme.textSecondary }]}
                  >
                    Équipe min. 6 danseurs. Niveau défini par le responsable
                    technique.
                  </AppText>
                )}
                {competitionType === "PROXIMITE" &&
                  newEventKind === "CLASSIFICATRICE" && (
                    <AppText
                      variant="caption"
                      style={[styles.mt6, { color: theme.textSecondary }]}
                    >
                      En proximité, seuls Débutant et Intermédiaire sont
                      autorisés.
                    </AppText>
                  )}
              </View>
            )}
          </ScrollView>

          <View style={styles.actionBtns}>
            <AppButton
              title="Annuler"
              variant="secondary"
              onPress={() => setShowEventModal(false)}
              style={styles.flex1}
            />
            <AppButton
              title="Ajouter"
              testID="event-editor-add-button"
              variant="primary"
              onPress={addEvent}
              style={styles.flex1}
            />
          </View>
        </View>
      </View>
    </Modal>
  </>
);
