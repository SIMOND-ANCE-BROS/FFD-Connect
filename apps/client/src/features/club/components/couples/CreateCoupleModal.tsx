import { Check, Search } from "lucide-react-native";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { AppButton } from "../../../../components/AppButton";
import { AppText } from "../../../../components/AppText";
import type { AppTheme } from "../../../../context/ThemeContext";
import type { ClubMember, ClubOption } from "../../services/ClubService";
import { styles } from "./club-couples.styles";

interface CreateCoupleModalProps {
  theme: AppTheme;
  visible: boolean;
  onClose: () => void;
  clubsForPartnership: ClubOption[];
  primaryClubName: string;
  selectedSecondaryClubId: string | null;
  setSelectedSecondaryClubId: (id: string | null) => void;
  clubPickerVisible: boolean;
  setClubPickerVisible: (visible: boolean) => void;
  availableMembers: ClubMember[];
  filteredMembers: ClubMember[];
  membersLoading: boolean;
  memberSearchQuery: string;
  setMemberSearchQuery: (query: string) => void;
  selectedPartnerIds: string[];
  togglePartner: (id: string) => void;
  handleCreatePartnership: () => void;
}

export const CreateCoupleModal = React.memo(function CreateCoupleModal({
  theme,
  visible,
  onClose,
  clubsForPartnership,
  primaryClubName,
  selectedSecondaryClubId,
  setSelectedSecondaryClubId,
  clubPickerVisible,
  setClubPickerVisible,
  availableMembers,
  filteredMembers,
  membersLoading,
  memberSearchQuery,
  setMemberSearchQuery,
  selectedPartnerIds,
  togglePartner,
  handleCreatePartnership,
}: CreateCoupleModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalBox,
            styles.createModalBox,
            { backgroundColor: theme.surface },
          ]}
        >
          <AppText variant="h3" style={[styles.mb8, { color: theme.text }]}>
            Créer un couple
          </AppText>
          <AppText
            variant="caption"
            style={[styles.mb8, { color: theme.textSecondary }]}
          >
            Sélectionnez 2 membres actifs non déjà en couple (max. 2).
          </AppText>
          {clubsForPartnership.length > 0 && (
            <View style={styles.mb12}>
              <AppText
                variant="caption"
                style={[styles.mb4, { color: theme.textSecondary }]}
              >
                Couple inter-club (optionnel)
              </AppText>
              <TouchableOpacity
                style={[
                  styles.selectRow,
                  {
                    borderColor: theme.border,
                    backgroundColor: theme.background,
                  },
                ]}
                onPress={() => setClubPickerVisible(!clubPickerVisible)}
                accessibilityRole="button"
                accessibilityLabel="Sélectionner un club partenaire"
                accessibilityHint="Ouvre la liste des clubs disponibles pour un partenariat inter-club"
              >
                <AppText variant="body" style={{ color: theme.text }}>
                  {selectedSecondaryClubId
                    ? (clubsForPartnership.find(
                        (c) => c.id === selectedSecondaryClubId,
                      )?.name ?? primaryClubName)
                    : primaryClubName}
                </AppText>
              </TouchableOpacity>
              {clubPickerVisible && (
                <View
                  style={[
                    styles.dropdown,
                    {
                      borderColor: theme.border,
                      backgroundColor: theme.surface,
                    },
                  ]}
                >
                  <FlatList
                    data={[
                      { id: "mono", name: primaryClubName },
                      ...clubsForPartnership,
                    ]}
                    keyExtractor={(item) => item.id}
                    style={styles.dropdownList}
                    renderItem={({ item }) => {
                      const isMono = item.id === "mono";
                      const isSelected = isMono
                        ? !selectedSecondaryClubId
                        : selectedSecondaryClubId === item.id;
                      const dropdownBg = {
                        borderBottomColor: theme.border,
                        backgroundColor: isSelected
                          ? theme.primary
                          : "transparent",
                      };
                      const dropdownTextColor = {
                        color: isSelected ? "#fff" : theme.text,
                      };
                      return (
                        <TouchableOpacity
                          style={[styles.dropdownItem, dropdownBg]}
                          accessibilityRole="button"
                          accessibilityLabel={item.name}
                          accessibilityHint="Sélectionne ce club comme partenaire"
                          onPress={() => {
                            if (isMono) {
                              setSelectedSecondaryClubId(null);
                            } else {
                              setSelectedSecondaryClubId(item.id);
                            }
                            setClubPickerVisible(false);
                          }}
                        >
                          <AppText
                            variant="body"
                            style={dropdownTextColor}
                            numberOfLines={1}
                          >
                            {item.name}
                          </AppText>
                        </TouchableOpacity>
                      );
                    }}
                  />
                </View>
              )}
            </View>
          )}
          {availableMembers.length > 0 && (
            <View
              style={[
                styles.searchRow,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.background,
                },
              ]}
            >
              <Search
                size={18}
                color={theme.textSecondary}
                style={styles.searchIcon}
              />
              <TextInput
                value={memberSearchQuery}
                onChangeText={setMemberSearchQuery}
                placeholder="Rechercher (nom, prénom, n° licence)"
                placeholderTextColor={theme.textSecondary}
                style={[styles.searchInput, { color: theme.text }]}
                accessibilityLabel="Rechercher un membre"
                accessibilityHint="Filtrer par nom, prénom ou numéro de licence"
              />
            </View>
          )}
          {membersLoading ? (
            <ActivityIndicator color={theme.primary} style={styles.marginV24} />
          ) : availableMembers.length === 0 ? (
            <AppText variant="body" style={{ color: theme.textSecondary }}>
              Tous les membres actifs sont déjà en couple. Clôturez un
              partenariat pour recréer un couple.
            </AppText>
          ) : (
            <FlatList
              data={filteredMembers}
              keyExtractor={(m) => m.id}
              ListEmptyComponent={
                <AppText
                  variant="body"
                  style={[
                    styles.padV16TextCenter,
                    { color: theme.textSecondary },
                  ]}
                >
                  Aucun membre ne correspond à la recherche.
                </AppText>
              }
              style={styles.createModalList}
              renderItem={({ item }) => {
                const isChecked = selectedPartnerIds.includes(item.id);
                const canCheck = selectedPartnerIds.length < 2 || isChecked;
                return (
                  <TouchableOpacity
                    style={[
                      styles.pickerItem,
                      styles.pickerItemWithCheckbox,
                      { borderBottomColor: theme.border },
                    ]}
                    onPress={() => canCheck && togglePartner(item.id)}
                    disabled={!canCheck && !isChecked}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${item.firstName} ${item.lastName}`}
                    accessibilityHint="Sélectionne ce membre pour le couple"
                    accessibilityState={{ checked: isChecked }}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        { borderColor: theme.border },
                        isChecked ? { backgroundColor: theme.primary } : null,
                      ]}
                    >
                      {isChecked && (
                        <Check size={16} color="#fff" strokeWidth={3} />
                      )}
                    </View>
                    <AppText
                      variant="body"
                      style={[styles.flex1, { color: theme.text }]}
                    >
                      {item.firstName} {item.lastName}
                    </AppText>
                  </TouchableOpacity>
                );
              }}
            />
          )}
          <View style={styles.modalActions}>
            <AppButton variant="secondary" onPress={onClose} title="Annuler" />
            <AppButton
              onPress={handleCreatePartnership}
              title="Créer"
              disabled={selectedPartnerIds.length !== 2}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
});
