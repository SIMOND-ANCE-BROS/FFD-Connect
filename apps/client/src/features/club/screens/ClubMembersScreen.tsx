/* eslint-disable react-native-a11y/has-accessibility-hint -- TODO: add accessibilityHint to member list items */
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../../navigation/types";
import { Award, MoreVertical, Plus, User } from "lucide-react-native";
import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../../components/AppText";
import { BackButton } from "../../../components/BackButton";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { SearchBar } from "../../../components/SearchBar";
import { useTheme } from "../../../context/ThemeContext";
import { useClubMembersLogic } from "../hooks/useClubMembersLogic";
import { formatDiscipline } from "../../../utils/discipline";

export const ClubMembersScreen = () => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [headerH, setHeaderH] = React.useState(insets.top + 120);

  const { members, isLoading, searchQuery, setSearchQuery, refresh } =
    useClubMembersLogic();

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {isLoading && members.length === 0 ? (
        <View style={[styles.center, { paddingTop: headerH }]}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <FlashList
          data={members}
          onRefresh={() => {
            refresh().catch(() => {});
          }}
          refreshing={isLoading}
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: theme.surface }]}>
              <TouchableOpacity
                accessibilityRole="button"
                testID={`club-member-${item.id}`}
                activeOpacity={0.7}
                onPress={() =>
                  navigation.navigate("ClubMemberEditor", {
                    member: item,
                  })
                }
                style={styles.cardMain}
              >
                <View style={styles.avatarContainer}>
                  <View
                    style={[styles.avatar, { backgroundColor: theme.primary }]}
                  >
                    <AppText variant="h3" style={styles.textWhite}>
                      {item.firstName[0]}
                      {item.lastName[0]}
                    </AppText>
                  </View>
                </View>
                <View style={styles.infoContainer}>
                  <AppText
                    variant="body"
                    style={[styles.fontWeight600, { color: theme.text }]}
                  >
                    {item.firstName} {item.lastName}
                  </AppText>
                  <AppText
                    variant="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    {item.license?.number ?? "Sans licence"} •{" "}
                    {(item.category ? formatDiscipline(item.category) : null) ??
                      item.ageGroup ??
                      "—"}
                  </AppText>
                </View>
                <View style={styles.actionButton}>
                  <MoreVertical size={20} color={theme.textSecondary} />
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.careerIconBtn,
                  { backgroundColor: theme.background },
                ]}
                onPress={() =>
                  navigation.navigate("ViewCareer", {
                    userId: item.id,
                    userName: `${item.firstName} ${item.lastName}`.trim(),
                  })
                }
                accessibilityLabel="Voir la carrière"
              >
                <Award size={20} color={theme.primary} />
              </TouchableOpacity>
            </View>
          )}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingTop: headerH, paddingBottom: insets.bottom + 80 },
          ]}
          ListEmptyComponent={
            <View style={styles.center}>
              <User
                size={48}
                color={theme.textSecondary}
                style={styles.marginBottom12}
              />
              <AppText
                variant="h3"
                align="center"
                style={[styles.marginBottom8, { color: theme.text }]}
              >
                Aucun membre trouvé
              </AppText>
              <AppText
                variant="body"
                align="center"
                style={{ color: theme.textSecondary }}
              >
                Recherchez un autre nom ou ajoutez un nouveau membre. Les
                couples et équipes se gèrent depuis le tableau de bord club.
              </AppText>
            </View>
          }
        />
      )}

      <PinnedHeader
        theme={theme}
        isDark={isDark}
        title="Membres"
        left={<BackButton onPress={() => navigation.goBack()} />}
        onHeightChange={setHeaderH}
      >
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Rechercher un membre…"
          testID="club-members-search"
        />
      </PinnedHeader>

      <TouchableOpacity
        accessibilityRole="button"
        testID="club-members-add-button"
        style={[
          styles.fab,
          { backgroundColor: theme.primary, bottom: insets.bottom + 20 },
        ]}
        onPress={() => navigation.navigate("ClubMemberEditor")}
      >
        <Plus size={24} color="#FFF" />
        <AppText
          variant="button"
          style={[styles.textWhite, styles.marginLeft8]}
        >
          Ajouter
        </AppText>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  textWhite: { color: "#fff" },
  fontWeight600: { fontWeight: "600" },
  marginBottom12: { marginBottom: 12 },
  marginBottom8: { marginBottom: 8 },
  marginLeft8: { marginLeft: 8 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 50,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 4,
  },
  listContent: {
    paddingHorizontal: 16,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
  },
  avatarContainer: {
    marginRight: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  infoContainer: {
    flex: 1,
  },
  cardMain: { flex: 1, flexDirection: "row", alignItems: "center" },
  actionButton: {
    padding: 8,
  },
  careerIconBtn: {
    padding: 10,
    borderRadius: 10,
    marginLeft: 4,
  },
  fab: {
    position: "absolute",
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 30,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});
