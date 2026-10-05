/* eslint-disable react-native-a11y/has-valid-accessibility-descriptors -- TODO: add a11y descriptors to team actions */
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Plus, Trash2 } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { BackButton } from "../../../components/BackButton";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import { ClubService, type ClubMember } from "../services/ClubService";
import { TeamIcon } from "../../../components/icons/TeamIcon";

type Props = NativeStackScreenProps<RootStackParamList, "ClubSoloTeamDetail">;

export const ClubSoloTeamDetailScreen = ({ navigation, route }: Props) => {
  const { teamId } = route.params;
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [headerH, setHeaderH] = useState(insets.top + 56);

  const { data: team, isLoading } = useQuery({
    queryKey: ["clubSoloTeam", teamId],
    queryFn: () => ClubService.getSoloTeam(teamId),
    enabled: !!teamId,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["clubMembers"],
    queryFn: () => ClubService.getMembers(),
    enabled: addModalVisible,
  });

  const refresh = useCallback(() => {
    queryClient
      .invalidateQueries({ queryKey: ["clubSoloTeam", teamId] })
      .catch(() => {});
    queryClient
      .invalidateQueries({ queryKey: ["clubSoloTeams"] })
      .catch(() => {});
  }, [queryClient, teamId]);

  const handleAddMember = async (userId: string) => {
    try {
      await ClubService.addSoloTeamMember(teamId, userId);
      setAddModalVisible(false);
      refresh();
    } catch (e: unknown) {
      Alert.alert(
        "Erreur",
        (e as { response?: { data?: { message?: string } } }).response?.data
          ?.message ?? "Impossible d'ajouter le membre.",
      );
    }
  };

  const handleRemoveMember = (userId: string, name: string) => {
    Alert.alert("Retirer le membre", `Retirer ${name} de l'équipe ?`, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Retirer",
        style: "destructive",
        onPress: () => {
          ClubService.removeSoloTeamMember(teamId, userId)
            .then(() => {
              refresh();
            })
            .catch((e: unknown) => {
              Alert.alert(
                "Erreur",
                (e as { response?: { data?: { message?: string } } }).response
                  ?.data?.message ?? "Impossible de retirer le membre.",
              );
            });
        },
      },
    ]);
  };

  const memberIds = new Set((team?.members ?? []).map((m) => m.userId));
  const availableMembers = members.filter(
    (m: ClubMember) => !memberIds.has(m.id),
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {isLoading || !team ? (
        <View style={[styles.centered, { paddingTop: headerH + 8 }]}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <>
          <View style={{ height: headerH + 8 }} />
          <View style={[styles.infoCard, { backgroundColor: theme.surface }]}>
            <View style={[styles.avatar, { backgroundColor: theme.primary }]}>
              <TeamIcon size={28} color="#fff" />
            </View>
            <View style={styles.infoBody}>
              <AppText variant="h3" style={{ color: theme.text }}>
                {team.name}
              </AppText>
              <AppText variant="body" style={{ color: theme.textSecondary }}>
                Niveau {team.level}
              </AppText>
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <AppText variant="h3" style={{ color: theme.text }}>
              Membres ({team.members.length})
            </AppText>
            <TouchableOpacity
              onPress={() => setAddModalVisible(true)}
              style={[styles.addButton, { backgroundColor: theme.primary }]}
            >
              <Plus size={18} color="#fff" />
              <AppText variant="button" style={styles.textWhite}>
                Ajouter
              </AppText>
            </TouchableOpacity>
          </View>

          <FlashList
            data={team.members}
            keyExtractor={(m) => m.id}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: insets.bottom + 24 },
            ]}
            renderItem={({ item }) => (
              <View
                style={[styles.memberRow, { backgroundColor: theme.surface }]}
              >
                <View
                  style={[
                    styles.memberAvatar,
                    { backgroundColor: theme.background },
                  ]}
                >
                  <AppText variant="body" style={{ color: theme.text }}>
                    {item.user.firstName[0]}
                    {item.user.lastName[0]}
                  </AppText>
                </View>
                <View style={styles.memberBody}>
                  <AppText variant="body" style={{ color: theme.text }}>
                    {item.user.firstName} {item.user.lastName}
                  </AppText>
                  {item.user.competitionLevel && (
                    <AppText
                      variant="caption"
                      style={{ color: theme.textSecondary }}
                    >
                      {item.user.competitionLevel}
                    </AppText>
                  )}
                </View>
                <TouchableOpacity
                  onPress={() =>
                    handleRemoveMember(
                      item.userId,
                      `${item.user.firstName} ${item.user.lastName}`,
                    )
                  }
                  style={styles.removeButton}
                >
                  <Trash2 size={20} color={theme.textSecondary} />
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              <AppText
                variant="body"
                style={[styles.emptyText, { color: theme.textSecondary }]}
              >
                Aucun membre. Ajoutez des danseurs pour constituer l'équipe
                (min. 6 pour une Solo Team).
              </AppText>
            }
          />
        </>
      )}

      <PinnedHeader
        theme={theme}
        isDark={isDark}
        title={team?.name ?? "…"}
        left={<BackButton onPress={() => navigation.goBack()} />}
        onHeightChange={setHeaderH}
      />

      <Modal visible={addModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: theme.surface }]}>
            <AppText
              variant="h3"
              style={[styles.modalTitle, { color: theme.text }]}
            >
              Ajouter un membre
            </AppText>
            <ScrollView
              style={styles.modalScroll}
              showsVerticalScrollIndicator={false}
            >
              {availableMembers.length === 0 ? (
                <AppText variant="body" style={{ color: theme.textSecondary }}>
                  Tous les membres du club sont déjà dans l'équipe.
                </AppText>
              ) : (
                availableMembers.map((m: ClubMember) => (
                  <TouchableOpacity
                    key={m.id}
                    onPress={() => {
                      handleAddMember(m.id).catch(() => {});
                    }}
                    style={[
                      styles.memberChip,
                      {
                        backgroundColor: theme.background,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <AppText variant="body" style={{ color: theme.text }}>
                      {m.firstName} {m.lastName}
                    </AppText>
                    {m.competitionLevel && (
                      <AppText
                        variant="caption"
                        style={{ color: theme.textSecondary }}
                      >
                        {m.competitionLevel}
                      </AppText>
                    )}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
            <AppButton
              variant="secondary"
              onPress={() => setAddModalVisible(false)}
              title="Fermer"
              style={styles.modalClose}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  textWhite: { color: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  backButton: { marginRight: 12, padding: 4 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  infoCard: {
    flexDirection: "row",
    alignItems: "center",
    margin: 16,
    padding: 16,
    borderRadius: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  infoBody: { flex: 1 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  listContent: { paddingHorizontal: 16 },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  memberBody: { flex: 1 },
  removeButton: { padding: 8 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalBox: { width: "100%", maxWidth: 400, borderRadius: 16, padding: 24 },
  modalScroll: { maxHeight: 320 },
  memberChip: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  modalClose: { marginTop: 16 },
  modalTitle: { marginBottom: 16 },
  emptyText: { padding: 16 },
});
