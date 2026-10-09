/* eslint-disable react-native-a11y/has-valid-accessibility-descriptors -- TODO: add a11y to registration modal actions */
import { Check, X } from "lucide-react-native";
import React, { useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import { Event } from "../../competitions/context/CompetitionContext";
import { ClubMember } from "../services/ClubService";
import { formatDiscipline } from "../../../utils/discipline";

interface Props {
  visible: boolean;
  onClose: () => void;
  event: Event;
  eligibleMembers: ClubMember[];
  onRegisterMembers: (
    memberIds: string[],
    partnerName?: string,
  ) => Promise<void>;
  isSaving?: boolean;
}

export const ClubEventRegistrationModal: React.FC<Props> = ({
  visible,
  onClose,
  event,
  eligibleMembers,
  onRegisterMembers,
  isSaving = false,
}) => {
  const { theme } = useTheme();
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [partnerName, setPartnerName] = useState("");

  const isCoupleEvent = event.eventType === "COUPLE" || !event.eventType;

  const toggleMember = (id: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  const handleSave = async () => {
    if (selectedMemberIds.length === 0) {
      Alert.alert("Info", "Sélectionnez au moins un membre.");
      return;
    }
    if (isCoupleEvent && !partnerName.trim()) {
      Alert.alert(
        "Info",
        "Indiquez le nom du partenaire pour cette épreuve couple.",
      );
      return;
    }
    try {
      await onRegisterMembers(
        selectedMemberIds,
        isCoupleEvent ? partnerName.trim() : undefined,
      );
      setSelectedMemberIds([]);
      setPartnerName("");
      onClose();
    } catch {
      // Error already shown by parent
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <View style={styles.flex1}>
            <AppText variant="h3" style={{ color: theme.text }}>
              Gérer les inscriptions
            </AppText>
            <AppText variant="caption" style={{ color: theme.textSecondary }}>
              {formatDiscipline(event.category)} {event.ageGroup}
              {event.eventType === "SOLO" ? " • Solo" : " • Couple"}
            </AppText>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={onClose}
            style={[styles.closeButton, { backgroundColor: theme.surface }]}
          >
            <X size={20} color={theme.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          {isCoupleEvent && (
            <View style={[styles.partnerRow, styles.partnerRowMargin]}>
              <AppText
                variant="caption"
                style={[styles.labelText, { color: theme.textSecondary }]}
              >
                Nom du partenaire (obligatoire)
              </AppText>
              <TextInput
                placeholder="Prénom Nom du partenaire"
                placeholderTextColor={theme.textSecondary}
                value={partnerName}
                onChangeText={setPartnerName}
                style={[
                  styles.partnerInput,
                  { color: theme.text, borderColor: theme.border },
                ]}
              />
            </View>
          )}
          {eligibleMembers.length === 0 ? (
            <View style={styles.emptyState}>
              <AppText variant="body" style={{ color: theme.textSecondary }}>
                Aucun membre éligible pour cette épreuve.
              </AppText>
            </View>
          ) : (
            <View style={styles.memberList}>
              {eligibleMembers.map((member) => {
                const isSelected = selectedMemberIds.includes(member.id);
                const memberCardBorder = {
                  backgroundColor: theme.surface,
                  borderColor: isSelected ? theme.primary : "transparent",
                };
                const checkboxStyle = {
                  borderColor: isSelected ? theme.primary : theme.textSecondary,
                  backgroundColor: isSelected ? theme.primary : "transparent",
                };
                return (
                  <TouchableOpacity
                    accessibilityRole="button"
                    key={member.id}
                    style={[styles.memberCard, memberCardBorder]}
                    onPress={() => toggleMember(member.id)}
                  >
                    <View style={styles.flex1}>
                      <AppText
                        variant="body"
                        weight="600"
                        style={{ color: theme.text }}
                      >
                        {member.partnerName
                          ? `${member.firstName} & ${member.partnerName}`
                          : `${member.firstName} ${member.lastName}`}
                      </AppText>
                      <AppText
                        variant="caption"
                        style={{ color: theme.textSecondary }}
                      >
                        {member.license?.number ?? "Sans licence"} •{" "}
                        {member.ageGroup ?? ""}{" "}
                        {formatDiscipline(member.category)}
                      </AppText>
                    </View>
                    <View style={[styles.checkbox, checkboxStyle]}>
                      {isSelected && <Check size={14} color="#FFF" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </ScrollView>

        {/* Footer Actions */}
        <View
          style={[
            styles.footer,
            { borderTopColor: theme.border, backgroundColor: theme.surface },
          ]}
        >
          <AppText
            variant="caption"
            style={[styles.footerText, { color: theme.textSecondary }]}
          >
            {selectedMemberIds.length} membre(s) sélectionné(s)
          </AppText>
          <AppButton
            title="Valider les inscriptions"
            onPress={() => {
              handleSave().catch(() => {});
            }}
            disabled={isSaving}
            loading={isSaving}
            style={styles.fullWidth}
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
    padding: 20,
  },
  partnerRow: {},
  partnerInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  emptyState: {
    alignItems: "center",
    padding: 40,
  },
  memberCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    padding: 20,
    paddingBottom: 40,
    borderTopWidth: 1,
  },
  flex1: { flex: 1 },
  partnerRowMargin: { marginBottom: 16 },
  labelText: { marginBottom: 6 },
  memberList: { gap: 12, paddingBottom: 40 },
  footerText: { marginBottom: 12, textAlign: "center" },
  fullWidth: { width: "100%" },
});
