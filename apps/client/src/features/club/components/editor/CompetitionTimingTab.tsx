import DateTimePicker from "@react-native-community/datetimepicker";
import { Clock, Edit2, GripVertical, Plus, Trash2 } from "lucide-react-native";
import React from "react";
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
import { styles } from "./competition-editor.styles";

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
}: Props) {
  const renderTimingItem = ({
    item,
    drag,
    isActive,
  }: RenderItemParams<ScheduleItem>) => {
    const timingItemStyle = {
      backgroundColor: item.type === "BREAK" ? "transparent" : theme.surface,
      borderWidth: item.type === "BREAK" ? 1 : 0,
      borderColor: theme.border,
      opacity: isActive ? 0.7 : 1,
    };
    return (
      <ScaleDecorator>
        <TouchableOpacity
          accessibilityRole="button"
          onLongPress={drag}
          disabled={isActive}
          activeOpacity={1}
          style={[styles.card, timingItemStyle]}
        >
          <TouchableOpacity
            accessibilityRole="button"
            onPressIn={drag}
            style={styles.padding8}
          >
            <GripVertical size={20} color={theme.textSecondary} />
          </TouchableOpacity>

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

          <View style={styles.dirRow}>
            <TouchableOpacity
              accessibilityRole="button"
              testID={`timing-edit-${item.id}`}
              onPress={() => openTimingModal(item)}
              style={styles.iconButton}
            >
              <Edit2 size={18} color={theme.text} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              testID={`timing-delete-${item.id}`}
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

        <DraggableFlatList
          data={schedule}
          onDragEnd={({ data }) => handleDragEnd(data)}
          keyExtractor={(item) => item.id}
          renderItem={renderTimingItem}
          contentContainerStyle={styles.organisationContainer}
          ListFooterComponent={
            <TouchableOpacity
              accessibilityRole="button"
              style={[
                styles.addButton,
                styles.dashedBorderMT12,
                { borderColor: theme.primary },
              ]}
              onPress={() => openTimingModal()}
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
      <Modal visible={showTimingModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View
            style={[styles.modalContent, { backgroundColor: theme.surface }]}
          >
            <AppText variant="h3" style={[styles.mb16, { color: theme.text }]}>
              {editingTimingId ? "Modifier le créneau" : "Ajouter un créneau"}
            </AppText>

            <View style={styles.rowInput}>
              <View style={[styles.inputGroup, styles.flex1MR8]}>
                <AppText variant="caption" color={theme.textSecondary}>
                  Heure
                </AppText>
                <TouchableOpacity
                  accessibilityRole="button"
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
                <AppText variant="caption" color={theme.textSecondary}>
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
                    accessibilityLabel="Text input field"
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
              <AppText variant="caption" color={theme.textSecondary}>
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
              <AppText variant="caption" color={theme.textSecondary}>
                Titre
              </AppText>
              <TextInput
                accessibilityLabel="Text input field"
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
