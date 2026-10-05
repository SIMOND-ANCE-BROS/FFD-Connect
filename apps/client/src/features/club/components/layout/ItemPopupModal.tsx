import { Lock, RotateCw, X } from "lucide-react-native";
import React from "react";
import { Modal, ScrollView, TouchableOpacity, View } from "react-native";
import { AppText } from "../../../../components/AppText";
import { AppTheme } from "../../../../context/ThemeContext";
import type { LayoutItem } from "../../hooks/useClubCompetitionEditorLogic";
import { styles } from "./layout-canvas.styles";

interface ItemPopupModalProps {
  item: LayoutItem | null;
  theme: AppTheme;
  onClose: () => void;
  onEditElement: (item: LayoutItem) => void;
  onQuickEditElement?: (item: LayoutItem) => void;
  onToggleSeatLock: (id: string, seatIndex: number) => void;
  onCycleOrientation: (id: string) => void;
}

export function ItemPopupModal({
  item,
  theme,
  onClose,
  onEditElement,
  onQuickEditElement,
  onToggleSeatLock,
  onCycleOrientation,
}: ItemPopupModalProps) {
  const primaryColorStyle = { color: theme.primary };
  const popupTitleStyle = { color: theme.text };
  const popupButtonLabelStyle = primaryColorStyle;
  const popupPivotLabelStyle = [styles.popupPivotLabel, primaryColorStyle];
  const textSecondaryStyle = { color: theme.textSecondary };
  const popupHintStyle = [styles.popupHintText, textSecondaryStyle];
  const popupHint2Style = [styles.popupHintText2, textSecondaryStyle];
  const popupRowLabelStyle = [styles.popupRowLabel, textSecondaryStyle];
  const seatLabelStyle = [styles.seatLabel, { color: theme.surface }];
  const closeButtonLabelStyle = { color: theme.text };

  return (
    <Modal
      visible={!!item}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.popupBackdrop}
        activeOpacity={1}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Fermer le popup"
        accessibilityHint="Ferme le panneau de détails de l'élément"
      >
        <TouchableOpacity
          style={[styles.popupBox, { backgroundColor: theme.surface }]}
          activeOpacity={1}
          onPress={() => {}}
          accessibilityRole="none"
        >
          {item && (
            <>
              <View style={styles.popupHeader}>
                <AppText variant="h3" style={popupTitleStyle}>
                  {item.label}
                </AppText>
                <TouchableOpacity
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Fermer"
                  accessibilityHint="Ferme le panneau de détails"
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <X size={24} color={theme.text} />
                </TouchableOpacity>
              </View>

              <View style={styles.popupActions}>
                {(item.type === "GRADIN" || item.type === "TABLE") && (
                  <TouchableOpacity
                    style={[styles.popupButton, { borderColor: theme.primary }]}
                    accessibilityRole="button"
                    accessibilityLabel="Pivoter"
                    accessibilityHint="Change l'orientation de l'élément"
                    onPress={() => {
                      onCycleOrientation(item.id);
                    }}
                  >
                    <RotateCw size={18} color={theme.primary} />
                    <AppText variant="body" style={popupPivotLabelStyle}>
                      Pivoter
                    </AppText>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.popupButton, { borderColor: theme.primary }]}
                  accessibilityRole="button"
                  accessibilityLabel="Modifier"
                  accessibilityHint="Ouvre l'éditeur de nom et dimensions"
                  onPress={() => {
                    onClose();
                    onEditElement(item);
                  }}
                >
                  <AppText variant="body" style={popupButtonLabelStyle}>
                    Modifier (nom, dimensions)
                  </AppText>
                </TouchableOpacity>
                {onQuickEditElement && (
                  <TouchableOpacity
                    style={[styles.popupButton, { borderColor: theme.primary }]}
                    accessibilityRole="button"
                    accessibilityLabel="Dupliquer"
                    accessibilityHint="Crée une copie de cet élément"
                    onPress={() => {
                      onClose();
                      onQuickEditElement(item);
                    }}
                  >
                    <AppText variant="body" style={popupButtonLabelStyle}>
                      Dupliquer
                    </AppText>
                  </TouchableOpacity>
                )}
              </View>

              {(item.type === "GRADIN"
                ? (item.rows ?? 0) * (item.cols ?? 0) > 0
                : item.capacity > 0) && (
                <View style={styles.popupSeatsSection}>
                  <AppText variant="caption" style={popupHintStyle}>
                    Places — appuyez pour verrouiller / déverrouiller
                  </AppText>
                  <AppText variant="caption" style={popupHint2Style}>
                    Verrouillé = non réservable · Disponible = réservable
                  </AppText>
                  <ScrollView
                    style={styles.popupSeatsScroll}
                    contentContainerStyle={styles.popupSeatsContent}
                    showsVerticalScrollIndicator={false}
                  >
                    {item.type === "GRADIN" &&
                      item.rows != null &&
                      item.cols != null && (
                        <View style={styles.popupGrid}>
                          {Array.from({
                            length: item.rows,
                          }).map((_r, row) => (
                            <View key={row} style={styles.popupSeatsRow}>
                              <AppText
                                variant="caption"
                                style={popupRowLabelStyle}
                              >
                                {String.fromCharCode(65 + row)}
                              </AppText>
                              {Array.from({
                                length: item.cols!,
                              }).map((_c, col) => {
                                const idx = row * item.cols! + col;
                                const locked = (
                                  item.lockedSeats ?? []
                                ).includes(idx);
                                return (
                                  <TouchableOpacity
                                    key={idx}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Place ${String.fromCharCode(65 + row)}${col + 1}`}
                                    accessibilityHint={
                                      locked
                                        ? "Déverrouiller cette place"
                                        : "Verrouiller cette place"
                                    }
                                    style={[
                                      styles.popupSeat,
                                      {
                                        backgroundColor: locked
                                          ? theme.textSecondary
                                          : theme.primary,
                                        borderColor: locked
                                          ? theme.border
                                          : theme.primary,
                                      },
                                    ]}
                                    onPress={() =>
                                      onToggleSeatLock(item.id, idx)
                                    }
                                  >
                                    {locked ? (
                                      <Lock size={14} color={theme.surface} />
                                    ) : (
                                      <AppText
                                        variant="caption"
                                        style={seatLabelStyle}
                                      >
                                        {col + 1}
                                      </AppText>
                                    )}
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          ))}
                        </View>
                      )}
                    {(item.type === "TABLE" || item.type === "OTHER") && (
                      <View style={styles.popupSeatsRow}>
                        {Array.from({
                          length: item.capacity,
                        }).map((_, idx) => {
                          const locked = (item.lockedSeats ?? []).includes(idx);
                          return (
                            <TouchableOpacity
                              key={idx}
                              accessibilityRole="button"
                              accessibilityLabel={`Place ${idx + 1}`}
                              accessibilityHint={
                                locked
                                  ? "Déverrouiller cette place"
                                  : "Verrouiller cette place"
                              }
                              style={[
                                styles.popupSeat,
                                {
                                  backgroundColor: locked
                                    ? theme.textSecondary
                                    : theme.primary,
                                  borderColor: locked
                                    ? theme.border
                                    : theme.primary,
                                },
                              ]}
                              onPress={() => onToggleSeatLock(item.id, idx)}
                            >
                              {locked ? (
                                <Lock size={14} color={theme.surface} />
                              ) : (
                                <AppText
                                  variant="caption"
                                  style={seatLabelStyle}
                                >
                                  {idx + 1}
                                </AppText>
                              )}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </ScrollView>
                </View>
              )}

              <TouchableOpacity
                style={[
                  styles.popupButton,
                  styles.popupClose,
                  { backgroundColor: theme.border },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Fermer"
                accessibilityHint="Ferme le panneau de détails"
                onPress={onClose}
              >
                <AppText variant="body" style={closeButtonLabelStyle}>
                  Fermer
                </AppText>
              </TouchableOpacity>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}
