/* eslint-disable react-native-a11y/has-valid-accessibility-descriptors -- TODO: add a11y descriptors to team list items */
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../../navigation/types";
import { Plus } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  TextInput,
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
import { SearchBar } from "../../../components/SearchBar";
import { useTheme } from "../../../context/ThemeContext";
import { ClubService } from "../services/ClubService";
import { TeamIcon } from "../../../components/icons/TeamIcon";

const LEVELS: Array<"Débutant" | "Intermédiaire"> = [
  "Débutant",
  "Intermédiaire",
];

export const ClubSoloTeamsScreen = () => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLevel, setNewLevel] = useState<"Débutant" | "Intermédiaire">(
    "Débutant",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [headerH, setHeaderH] = useState(insets.top + 120);

  const { data: teams = [], isLoading } = useQuery({
    queryKey: ["clubSoloTeams"],
    queryFn: () => ClubService.getSoloTeams(),
  });

  const filteredTeams = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t) => t.name.toLowerCase().includes(q));
  }, [teams, searchQuery]);

  const refresh = useCallback(() => {
    queryClient
      .invalidateQueries({ queryKey: ["clubSoloTeams"] })
      .catch(() => {});
  }, [queryClient]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      Alert.alert("Erreur", "Indiquez un nom pour l'équipe.");
      return;
    }
    try {
      await ClubService.createSoloTeam({ name, level: newLevel });
      setCreateModalVisible(false);
      setNewName("");
      setNewLevel("Débutant");
      refresh();
    } catch (e: unknown) {
      Alert.alert(
        "Erreur",
        (e as { response?: { data?: { message?: string } } }).response?.data
          ?.message ?? "Impossible de créer l'équipe.",
      );
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {isLoading ? (
        <View style={[styles.centered, { paddingTop: headerH }]}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <FlashList
          data={filteredTeams}
          keyExtractor={(t) => t.id}
          onRefresh={refresh}
          refreshing={isLoading}
          contentContainerStyle={[
            styles.listContent,
            { paddingTop: headerH, paddingBottom: insets.bottom + 100 },
          ]}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, { backgroundColor: theme.surface }]}
              onPress={() =>
                navigation.navigate("ClubSoloTeamDetail", {
                  teamId: item.id,
                })
              }
            >
              <View style={[styles.avatar, { backgroundColor: theme.primary }]}>
                <TeamIcon size={26} color="#fff" />
              </View>
              <View style={styles.cardBody}>
                <AppText
                  variant="body"
                  style={[styles.bold, { color: theme.text }]}
                >
                  {item.name}
                </AppText>
                <AppText
                  variant="caption"
                  style={{ color: theme.textSecondary }}
                >
                  Niveau {item.level} • {item.members.length} membre(s)
                </AppText>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.centered}>
              <TeamIcon size={56} color={theme.textSecondary} />
              <AppText
                variant="body"
                style={[styles.emptyText, { color: theme.textSecondary }]}
              >
                {searchQuery.trim()
                  ? "Aucune équipe trouvée"
                  : "Aucune équipe Solo Team"}
              </AppText>
            </View>
          }
        />
      )}

      <PinnedHeader
        theme={theme}
        isDark={isDark}
        title="Solo Teams"
        left={<BackButton onPress={() => navigation.goBack()} />}
        onHeightChange={setHeaderH}
      >
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Rechercher une équipe…"
          testID="club-solo-teams-search"
        />
      </PinnedHeader>

      <TouchableOpacity
        style={[
          styles.fab,
          { backgroundColor: theme.primary, bottom: insets.bottom + 20 },
        ]}
        onPress={() => setCreateModalVisible(true)}
      >
        <Plus size={24} color="#FFF" />
        <AppText
          variant="button"
          style={[styles.textWhite, styles.marginLeft8]}
        >
          Créer une équipe
        </AppText>
      </TouchableOpacity>

      <Modal visible={createModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: theme.surface }]}>
            <AppText
              variant="h3"
              style={[styles.modalTitle, { color: theme.text }]}
            >
              Nouvelle Solo Team
            </AppText>
            <AppText
              variant="caption"
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              Nom
            </AppText>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="Ex. Étoiles du club"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.input,
                { borderColor: theme.border, color: theme.text },
              ]}
            />
            <AppText
              variant="caption"
              style={[styles.levelLabel, { color: theme.textSecondary }]}
            >
              Niveau
            </AppText>
            <View style={styles.levelRow}>
              {LEVELS.map((l) => {
                const isSelected = newLevel === l;
                const chipBg = isSelected ? theme.primary : theme.background;
                const chipTextColor = isSelected ? "#fff" : theme.text;
                return (
                  <TouchableOpacity
                    key={l}
                    onPress={() => setNewLevel(l)}
                    style={[
                      styles.chip,
                      { backgroundColor: chipBg, borderColor: theme.border },
                    ]}
                  >
                    <AppText
                      variant="button"
                      style={[styles.chipText, { color: chipTextColor }]}
                    >
                      {l}
                    </AppText>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.modalActions}>
              <AppButton
                variant="secondary"
                onPress={() => {
                  setCreateModalVisible(false);
                  setNewName("");
                }}
                title="Annuler"
              />
              <AppButton
                onPress={() => {
                  handleCreate().catch(() => {});
                }}
                title="Créer"
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  textWhite: { color: "#fff" },
  marginLeft8: { marginLeft: 8 },
  bold: { fontWeight: "600" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  backButton: { marginRight: 12, padding: 4 },
  listContent: { paddingHorizontal: 16, paddingTop: 16 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  cardBody: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 60,
  },
  fab: {
    position: "absolute",
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 30,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalBox: { width: "100%", maxWidth: 400, borderRadius: 16, padding: 24 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16 },
  modalTitle: { marginBottom: 16 },
  fieldLabel: { marginBottom: 4 },
  levelLabel: { marginBottom: 4, marginTop: 12 },
  levelRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  chip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 24,
  },
  emptyText: { marginTop: 12 },
  chipText: {},
});
