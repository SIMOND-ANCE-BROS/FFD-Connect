import DateTimePicker from "@react-native-community/datetimepicker";
import { Clock, Edit2, GripVertical, Plus, Trash2 } from "lucide-react-native";
import React, { useRef } from "react";
import {
  Modal,
  Platform,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator as ScaleDecoratorBase,
} from "react-native-draggable-flatlist";

const ScaleDecorator = ScaleDecoratorBase as React.FC<{
  activeScale?: number;
  children?: React.ReactNode;
}>;
import { AppButton } from "../../../../components/AppButton";
import { AppText } from "../../../../components/AppText";
import { FluidSegmentedTab } from "../../../../components/FluidSegmentedTab";
import { AppTheme } from "../../../../context/ThemeContext";
import { ScheduleItem } from "../../hooks/useClubCompetitionEditorLogic";
import { joinA11yLabel } from "../../../../utils/a11y";
import { useRestoreFocusOnClose } from "../../../../utils/a11yFocus";
import { announce } from "../../../../utils/announce";
import { EditorNotice } from "./EditorNotice";
import { styles } from "./competition-editor.styles";

/** Spoken type of a schedule slot (the raw enum is not French). */
const TIMING_TYPE_LABELS: Record<string, string> = {
  ROUND: "Tour",
  BREAK: "Pause",
  CEREMONY: "Cérémonie",
  OTHER: "Autre",
};

/** One slot read as a single sentence: "14:30, 20 minutes, Finale, Tour". */
export function timingAccessibilityLabel(item: ScheduleItem): string {
  return joinA11yLabel([
    item.startTime,
    `${item.duration} minutes`,
    item.title,
    TIMING_TYPE_LABELS[item.type] ?? item.type,
  ]);
}

/** Visual caption above a field that already carries the same name. */
const HIDDEN_CAPTION = {
  accessibilityElementsHidden: true,
  importantForAccessibility: "no-hide-descendants",
} as const;

interface Props {
  theme: AppTheme;
  schedule: ScheduleItem[];
  handleDragEnd: (data: ScheduleItem[]) => void;
  showTimingModal: boolean;
  setShowTimingModal: (v: boolean) => void;
  newTime: Date;
  showTimePicker: boolean;
  setShowTimePicker: (v: boolean) => void;
  newTimeText: string;
  onTimeChange: (_event: unknown, date?: Date) => void;
  newTimingType: "ROUND" | "BREAK" | "CEREMONY" | "OTHER";
  setNewTimingType: (t: "ROUND" | "BREAK" | "CEREMONY" | "OTHER") => void;
  newTimingTitle: string;
  setNewTimingTitle: (t: string) => void;
  newTimingDuration: string;
  setNewTimingDuration: (d: string) => void;
  editingTimingId: string | null;
  openTimingModal: (item?: ScheduleItem) => void;
  saveTiming: () => void;
  removeTiming: (id: string) => void;
  /** Banner above the schedule (loading, not loadable…), if any. */
  notice?: string;
}

export function CompetitionTimingTab({
  theme,
  schedule,
  handleDragEnd,
  showTimingModal,
  setShowTimingModal,
  newTime,
  showTimePicker,
  setShowTimePicker,
  newTimeText,
  onTimeChange,
  newTimingType,
  setNewTimingType,
  newTimingTitle,
  setNewTimingTitle,
  newTimingDuration,
  setNewTimingDuration,
  editingTimingId,
  openTimingModal,
  saveTiming,
  removeTiming,
  notice,
}: Props) {
  // Where the reader focus goes back when the slot modal closes: the button
  // that opened it (« Ajouter un créneau » or the slot's edit button).
  const addButtonRef = useRef<View>(null);
  const editButtonRefs = useRef(new Map<string, View>());
  const modalTriggerRef = useRef<View | null>(null);
  useRestoreFocusOnClose(showTimingModal, modalTriggerRef);

  // Screen-reader alternative to drag-and-drop (WCAG 2.5.7).
  const moveTiming = (id: string, delta: -1 | 1) => {
    const from = schedule.findIndex((s) => s.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= schedule.length) return;
    const next = [...schedule];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    handleDragEnd(next);
    announce(`${moved.title} déplacé en position ${to + 1} sur ${next.length}`);
  };

  const renderTimingItem = ({
    item,
    drag,
    isActive,
  }: RenderItemParams<ScheduleItem>) => {
    const index = schedule.findIndex((s) => s.id === item.id);
    const moveActions = [
      ...(index > 0 ? [{ name: "moveUp", label: "Monter" }] : []),
      ...(index < schedule.length - 1
        ? [{ name: "moveDown", label: "Descendre" }]
        : []),
    ];
    const timingItemStyle = {
      backgroundColor: item.type === "BREAK" ? "transparent" : theme.surface,
      borderWidth: item.type === "BREAK" ? 1 : 0,
      borderColor: theme.border,
      opacity: isActive ? 0.7 : 1,
    };
    return (
      <ScaleDecorator>
        <TouchableOpacity
          accessible={false}
          onLongPress={drag}
          disabled={isActive}
          activeOpacity={1}
          style={[styles.card, timingItemStyle]}
        >
          {/* Drag handle: not usable with a screen reader, which gets the
              « Monter / Descendre » actions on the slot instead. */}
          {/* eslint-disable-next-line react-native-a11y/has-valid-accessibility-descriptors -- hidden from assistive tech on purpose */}
          <TouchableOpacity
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onPressIn={drag}
            style={styles.padding8}
          >
            <GripVertical size={20} color={theme.textSecondary} />
          </TouchableOpacity>

          <View
            accessible
            accessibilityLabel={timingAccessibilityLabel(item)}
            accessibilityHint="Actions disponibles : monter, descendre"
            accessibilityActions={moveActions}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === "moveUp")
                moveTiming(item.id, -1);
              else if (event.nativeEvent.actionName === "moveDown")
                moveTiming(item.id, 1);
            }}
            testID={`timing-summary-${item.id}`}
            style={styles.timingSummary}
          >
            <View style={styles.timeAlignCol}>
              <AppText
                variant="body"
                weight="600"
                style={{ color: theme.primary }}
              >
                {item.startTime}
              </AppText>
              <AppText variant="caption" style={{ color: theme.textSecondary }}>
                {item.duration} min
              </AppText>
            </View>

            <View style={styles.flex1PadH12}>
              <AppText
                variant="body"
                style={{ color: theme.text }}
                numberOfLines={1}
              >
                {item.title}
              </AppText>
              <AppText variant="caption" style={{ color: theme.textSecondary }}>
                {item.type}
              </AppText>
            </View>
          </View>

          <View style={styles.dirRow}>
            <TouchableOpacity
              ref={(node) => {
                if (node) editButtonRefs.current.set(item.id, node);
                else editButtonRefs.current.delete(item.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Modifier le créneau : ${item.title}`}
              accessibilityHint="Ouvre le formulaire du créneau"
              testID={`timing-edit-${item.id}`}
              hitSlop={4}
              onPress={() => {
                modalTriggerRef.current =
                  editButtonRefs.current.get(item.id) ?? null;
                openTimingModal(item);
              }}
              style={styles.iconButton}
            >
              <Edit2 size={18} color={theme.text} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Supprimer le créneau : ${item.title}`}
              accessibilityHint="Retire le créneau du planning"
              testID={`timing-delete-${item.id}`}
              hitSlop={4}
              onPress={() => removeTiming(item.id)}
              style={styles.iconButton}
            >
              <Trash2 size={18} color={theme.danger} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </ScaleDecorator>
    );
  };

  return (
    <>
      <View style={styles.flex1}>
        <View style={[styles.sectionHeader, styles.mb16PadH20]}>
          <AppText variant="body" style={{ color: theme.textSecondary }}>
            Organisez le planning par glisser-déposer.
          </AppText>
        </View>
        {notice ? (
          <EditorNotice
            theme={theme}
            testID="competition-timing-notice"
            message={notice}
          />
        ) : null}

        <DraggableFlatList
          data={schedule}
          onDragEnd={({ data }) => handleDragEnd(data)}
          keyExtractor={(item) => item.id}
          renderItem={renderTimingItem}
          contentContainerStyle={styles.organisationContainer}
          ListFooterComponent={
            <TouchableOpacity
              ref={addButtonRef}
              accessibilityRole="button"
              accessibilityLabel="Ajouter un créneau"
              accessibilityHint="Ouvre le formulaire d'ajout de créneau"
              style={[
                styles.addButton,
                styles.dashedBorderMT12,
                { borderColor: theme.primary },
              ]}
              onPress={() => {
                modalTriggerRef.current = addButtonRef.current;
                openTimingModal();
              }}
            >
              <Plus size={24} color={theme.primary} />
              <AppText
                variant="button"
                style={[styles.ml8, { color: theme.primary }]}
              >
                Ajouter un créneau
              </AppText>
            </TouchableOpacity>
          }
        />
      </View>

      {/* Add/Edit Timing Modal */}
      <Modal
        visible={showTimingModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTimingModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            accessibilityViewIsModal
            style={[styles.modalContent, { backgroundColor: theme.surface }]}
          >
            <AppText
              variant="h3"
              style={[styles.mb16, { color: theme.text }]}
              accessibilityRole="header"
            >
              {editingTimingId ? "Modifier le créneau" : "Ajouter un créneau"}
            </AppText>

            <View style={styles.rowInput}>
              <View style={[styles.inputGroup, styles.flex1MR8]}>
                <AppText
                  variant="caption"
                  color={theme.textSecondary}
                  {...HIDDEN_CAPTION}
                >
                  Heure
                </AppText>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Heure, ${newTimeText}`}
                  accessibilityHint="Ouvre le sélecteur d'heure"
                  testID="timing-time-button"
                  onPress={() => setShowTimePicker(true)}
                  style={[
                    styles.inputContainer,
                    {
                      backgroundColor: theme.background,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Clock
                    size={20}
                    color={theme.textSecondary}
                    style={styles.inputIcon}
                  />
                  <AppText variant="body" style={{ color: theme.text }}>
                    {newTimeText}
                  </AppText>
                </TouchableOpacity>
                {showTimePicker && (
                  <DateTimePicker
                    value={newTime}
                    mode="time"
                    display={Platform.OS === "ios" ? "spinner" : "default"}
                    onChange={onTimeChange}
                    is24Hour={true}
                  />
                )}
              </View>

              <View style={[styles.inputGroup, styles.w100]}>
                <AppText
                  variant="caption"
                  color={theme.textSecondary}
                  {...HIDDEN_CAPTION}
                >
                  Durée (min)
                </AppText>
                <View
                  style={[
                    styles.inputContainer,
                    {
                      backgroundColor: theme.background,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <TextInput
                    accessibilityLabel="Durée du créneau en minutes"
                    accessibilityHint="Saisissez la durée"
                    style={[
                      styles.input,
                      styles.textCenter,
                      { color: theme.text },
                    ]}
                    keyboardType="numeric"
                    value={newTimingDuration}
                    onChangeText={setNewTimingDuration}
                  />
                </View>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <AppText
                variant="caption"
                color={theme.textSecondary}
                accessibilityRole="header"
              >
                Type
              </AppText>
              <FluidSegmentedTab
                activeValue={newTimingType}
                onChange={(v: string) =>
                  setNewTimingType(
                    v as "ROUND" | "BREAK" | "CEREMONY" | "OTHER",
                  )
                }
                options={[
                  { label: "Tour", value: "ROUND" },
                  { label: "Pause", value: "BREAK" },
                  { label: "Cérémonie", value: "CEREMONY" },
                ]}
              />
            </View>

            <View style={styles.inputGroup}>
              <AppText
                variant="caption"
                color={theme.textSecondary}
                {...HIDDEN_CAPTION}
              >
                Titre
              </AppText>
              <TextInput
                accessibilityLabel="Titre du créneau"
                accessibilityHint="Saisissez le titre du créneau"
                testID="timing-title-input"
                style={[
                  styles.input,
                  styles.borderBox,
                  { color: theme.text, borderColor: theme.border },
                ]}
                placeholder="Ex: Finale Latine Adulte"
                placeholderTextColor={theme.textSecondary}
                value={newTimingTitle}
                onChangeText={setNewTimingTitle}
              />
            </View>

            <View style={styles.actionBtns}>
              <AppButton
                title="Annuler"
                variant="secondary"
                onPress={() => setShowTimingModal(false)}
                style={styles.flex1}
              />
              <AppButton
                title="Sauvegarder"
                variant="primary"
                onPress={saveTiming}
                style={styles.flex1}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
