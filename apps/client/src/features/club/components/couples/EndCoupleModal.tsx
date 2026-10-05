import React from "react";
import { Modal, TextInput, View } from "react-native";
import { AppButton } from "../../../../components/AppButton";
import { AppText } from "../../../../components/AppText";
import type { AppTheme } from "../../../../context/ThemeContext";
import type { Partnership } from "../../services/ClubService";
import { styles } from "./club-couples.styles";

interface EndCoupleModalProps {
  theme: AppTheme;
  visible: boolean;
  selectedPartnership: Partnership | null;
  endDate: string;
  setEndDate: (date: string) => void;
  onClose: () => void;
  onEnd: () => void;
}

const name = (u: { firstName: string; lastName: string }) =>
  `${u.firstName} ${u.lastName}`;

export const EndCoupleModal = React.memo(function EndCoupleModal({
  theme,
  visible,
  selectedPartnership,
  endDate,
  setEndDate,
  onClose,
  onEnd,
}: EndCoupleModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={[styles.modalBox, { backgroundColor: theme.surface }]}>
          <AppText variant="h3" style={[styles.mb8, { color: theme.text }]}>
            Mettre fin au partenariat
          </AppText>
          {selectedPartnership && (
            <AppText
              variant="body"
              style={[styles.mb16, { color: theme.textSecondary }]}
            >
              {name(selectedPartnership.user1)} &{" "}
              {name(selectedPartnership.user2)}
            </AppText>
          )}
          <AppText
            variant="caption"
            style={[styles.mb4, { color: theme.textSecondary }]}
          >
            Date de fin (AAAA-MM-JJ)
          </AppText>
          <TextInput
            value={endDate}
            onChangeText={setEndDate}
            placeholder="2025-02-25"
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.dateInput,
              { borderColor: theme.border, color: theme.text },
            ]}
            accessibilityLabel="Date de fin du partenariat"
            accessibilityHint="Saisissez la date au format AAAA-MM-JJ"
          />
          <View style={styles.modalActions}>
            <AppButton variant="secondary" onPress={onClose} title="Annuler" />
            <AppButton onPress={onEnd} title="Clôturer" />
          </View>
        </View>
      </View>
    </Modal>
  );
});
