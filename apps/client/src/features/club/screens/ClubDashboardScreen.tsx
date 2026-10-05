import {
  ChevronRight,
  ClipboardList,
  LucideIcon,
  Settings as SettingsIcon,
  Trophy,
  User,
  Users,
  UsersRound,
} from "lucide-react-native";
import React, { useRef } from "react";
import {
  Animated,
  Dimensions,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { AppText } from "../../../components/AppText";
import {
  GlassHeader,
  GLASS_HEADER_HEIGHT,
} from "../../../components/GlassHeader";
import { NotificationBell } from "../../../components/NotificationBell";
import { AppTheme, useTheme } from "../../../context/ThemeContext";

import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { RootStackParamList } from "../../../navigation/types";
const { width } = Dimensions.get("window");
const CARD_WIDTH = (width - 60) / 2; // 2 columns with padding (20+20) + gap (16) -> safe 60 deduction

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createLogger } from "../../../utils/logger";
import { useAuthRepository } from "../../auth/context/AuthContext";
import { ClubService } from "../services/ClubService";
import type { ClubRegistrationMode } from "../services/ClubService";
import {
  DEFAULT_CLUB_DASHBOARD_WIDGETS,
  type ClubDashboardWidgetId,
} from "../types";
import DraggableFlatList, {
  type RenderItemParams as DraggableRenderItemParams,
} from "react-native-draggable-flatlist";
import { AppText as DraggableLabel } from "../../../components/AppText";

const logger = createLogger("ClubDashboardScreen");

// ... (existing imports)

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: number | string;
  color: string;
  onPress?: () => void;
  theme: AppTheme;
  testID?: string;
  iconSize?: number;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const StatCard = ({
  icon: Icon,
  label,
  value,
  color,
  onPress,
  theme,
  testID,
  iconSize,
  accessibilityLabel,
  accessibilityHint,
}: StatCardProps) => (
  <TouchableOpacity
    accessible
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? label}
    accessibilityHint={accessibilityHint}
    testID={testID}
    style={[styles.statCard, { backgroundColor: theme.surface }]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <View style={[styles.iconContainer, { backgroundColor: `${color}20` }]}>
      <Icon size={iconSize ?? 24} color={color} />
    </View>
    <AppText variant="h2" style={[styles.statValue, { color: theme.text }]}>
      {value}
    </AppText>
    <AppText
      variant="caption"
      style={[styles.statLabel, { color: theme.textSecondary }]}
    >
      {label}
    </AppText>
  </TouchableOpacity>
);

interface MenuRowProps {
  icon: LucideIcon;
  label: string;
  subtitle?: string;
  color: string;
  onPress: () => void;
  theme: AppTheme;
  testID?: string;
  iconSize?: number;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const MenuRow = ({
  icon: Icon,
  label,
  subtitle,
  color,
  onPress,
  theme,
  testID,
  iconSize,
  accessibilityLabel,
  accessibilityHint,
}: MenuRowProps) => (
  <TouchableOpacity
    accessible
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? label}
    accessibilityHint={accessibilityHint}
    testID={testID}
    style={[styles.menuRow, { backgroundColor: theme.surface }]}
    onPress={onPress}
  >
    <View style={styles.menuLeft}>
      <View style={[styles.menuIconBox, { backgroundColor: `${color}20` }]}>
        <Icon size={iconSize ?? 20} color={color} />
      </View>
      <View>
        <AppText
          variant="body"
          style={[styles.menuLabel, { color: theme.text }]}
        >
          {label}
        </AppText>
        {subtitle && (
          <AppText variant="caption" style={{ color: theme.textSecondary }}>
            {subtitle}
          </AppText>
        )}
      </View>
    </View>
    <ChevronRight size={20} color={theme.textSecondary} />
  </TouchableOpacity>
);

type ClubDashboardProps = NativeStackScreenProps<
  RootStackParamList,
  "ClubDashboard"
>;

export const ClubDashboardScreen = ({ navigation }: ClubDashboardProps) => {
  const auth = useAuthRepository();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const scrollY = useRef(new Animated.Value(0)).current;
  const [clubName, setClubName] = React.useState("Danse Club Paris");

  // State for dashboard stats — fetched via useFocusEffect below
  const [stats, setStats] = React.useState({
    members: 0,
    activeCompetitions: 0,
    pendingRegistrations: 0,
    nextEvent: null as string | null,
  });

  const [widgets, setWidgets] = React.useState<
    { id: ClubDashboardWidgetId; visible: boolean }[]
  >([
    { id: "members", visible: true },
    { id: "competitions", visible: true },
    { id: "couples", visible: true },
    { id: "soloTeams", visible: true },
    { id: "registrations", visible: true },
  ]);

  const [registrationMode, setRegistrationMode] =
    React.useState<ClubRegistrationMode | null>(null);

  const [isEditing, setIsEditing] = React.useState<boolean>(false);

  const persistWidgets = React.useCallback(
    async (next: { id: ClubDashboardWidgetId; visible: boolean }[]) => {
      try {
        await auth.setClubDashboardConfig(JSON.stringify(next));
      } catch (error) {
        logger.error("Failed to save club dashboard widgets config", error);
      }
    },
    [auth],
  );

  const loadDashboardData = React.useCallback(async () => {
    // 1. Club Info
    const config = await auth.getAuthConfig();
    if (config.clubName) {
      setClubName(config.clubName);
    }

    // 2. Member Count
    try {
      const members = await ClubService.getMembers();
      setStats((prev) => ({ ...prev, members: members.length }));
    } catch (error) {
      logger.error("Failed to load dashboard stats", error);
    }

    // 3. Registration mode (to show/hide pending registrations entry points)
    try {
      const { registrationMode: fetchedRegistrationMode } =
        await ClubService.getMyClubRegistrationMode();
      setRegistrationMode(fetchedRegistrationMode ?? "MEMBERS_AUTO_CONFIRM");
    } catch (error) {
      logger.error("Failed to load club registration mode", error);
      setRegistrationMode(null);
    }

    // 4. Dashboard widgets configuration (per user)
    try {
      const raw = await auth.getClubDashboardConfig();
      if (raw) {
        const parsed = JSON.parse(raw) as {
          id: ClubDashboardWidgetId;
          visible: boolean;
        }[];
        const validIds = new Set<ClubDashboardWidgetId>(
          DEFAULT_CLUB_DASHBOARD_WIDGETS.map((w) => w.id),
        );
        const sanitized = parsed.filter((p) => validIds.has(p.id));
        if (sanitized.length > 0) {
          setWidgets(sanitized);
        }
      }
    } catch (error) {
      logger.error("Failed to load club dashboard widgets config", error);
    }
  }, [auth]);

  useFocusEffect(
    React.useCallback(() => {
      loadDashboardData().catch(() => {});
    }, [loadDashboardData]),
  );

  const handleWidgetsReorder = React.useCallback(
    (next: { id: ClubDashboardWidgetId; visible: boolean }[]) => {
      setWidgets(next);
      persistWidgets(next).catch(() => {});
    },
    [persistWidgets],
  );

  const navigateTo = (screen: keyof RootStackParamList) => {
    // Type-safe navigation - TypeScript correctly infers the screen type
    // Each screen in RootStackParamList has its params type defined
    navigation.navigate(screen as never);
  };

  if (isEditing) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <GlassHeader
          theme={theme}
          isDark={isDark}
          title={clubName}
          scrollY={scrollY}
          right={
            <NotificationBell
              theme={theme}
              isDark={isDark}
              onPress={() => navigation.navigate("Notifications")}
            />
          }
        />

        <View
          style={[
            styles.content,
            { paddingTop: insets.top + GLASS_HEADER_HEIGHT + 8 },
          ]}
        >
          <View style={styles.sectionHeaderRow}>
            <AppText
              variant="h3"
              style={[styles.sectionTitle, { color: theme.text }]}
            >
              Aperçu (édition)
            </AppText>
            <TouchableOpacity
              accessible
              accessibilityRole="button"
              onPress={() => setIsEditing(false)}
              accessibilityLabel="Terminer la personnalisation"
              accessibilityHint="Quitte le mode édition du tableau de bord"
              style={[
                styles.gearButton,
                {
                  borderColor: theme.primary,
                  backgroundColor: `${theme.primary}15`,
                },
              ]}
              testID="club-dashboard-edit-widgets-button"
            >
              <SettingsIcon size={18} color={theme.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.editContainer}>
            <DraggableFlatList
              data={widgets}
              keyExtractor={(item) => item.id}
              onDragEnd={({ data }) => handleWidgetsReorder(data)}
              renderItem={({
                item,
                drag,
                isActive,
              }: DraggableRenderItemParams<{
                id: ClubDashboardWidgetId;
                visible: boolean;
              }>) => {
                const def = DEFAULT_CLUB_DASHBOARD_WIDGETS.find(
                  (d) => d.id === item.id,
                );
                if (!def) return null;

                const disabledByMode =
                  def.id === "registrations" &&
                  registrationMode !== "CLUB_AND_MEMBERS_PENDING";
                const visibilityBadgeStyle = {
                  borderColor: theme.border,
                  backgroundColor: item.visible
                    ? `${theme.primary}15`
                    : theme.background,
                  opacity: disabledByMode ? 0.4 : 1,
                };

                return (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`${def.label}, réordonner`}
                    accessibilityHint="Appui long pour déplacer le widget"
                    onLongPress={drag}
                    disabled={isActive}
                    style={[
                      styles.editItem,
                      {
                        backgroundColor: theme.surface,
                        borderColor: isActive ? theme.primary : theme.border,
                      },
                    ]}
                  >
                    <View style={styles.editItemLeft}>
                      <View
                        style={[
                          styles.menuIconBox,
                          { backgroundColor: `${def.color}20` },
                        ]}
                      >
                        <def.icon
                          size={def.id === "soloTeams" ? 22 : 20}
                          color={def.color}
                        />
                      </View>
                      <DraggableLabel
                        variant="body"
                        style={{ color: theme.text }}
                      >
                        {def.label}
                      </DraggableLabel>
                    </View>
                    <TouchableOpacity
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={
                        item.visible
                          ? `Masquer ${def.label}`
                          : `Afficher ${def.label}`
                      }
                      accessibilityHint={
                        item.visible
                          ? `Masque le widget ${def.label} du tableau de bord`
                          : `Affiche le widget ${def.label} sur le tableau de bord`
                      }
                      onPress={() => {
                        const next = widgets.map((w) =>
                          w.id === item.id ? { ...w, visible: !w.visible } : w,
                        );
                        setWidgets(next);
                        persistWidgets(next).catch(() => {});
                      }}
                      disabled={disabledByMode}
                      style={[styles.visibilityBadge, visibilityBadgeStyle]}
                    >
                      <DraggableLabel
                        variant="caption"
                        style={{
                          color: item.visible
                            ? theme.primary
                            : theme.textSecondary,
                        }}
                      >
                        {item.visible ? "Affiché" : "Caché"}
                      </DraggableLabel>
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassHeader
        theme={theme}
        isDark={isDark}
        title={clubName}
        scrollY={scrollY}
        right={
          <NotificationBell
            theme={theme}
            isDark={isDark}
            onPress={() => navigation.navigate("Notifications")}
          />
        }
      />

      <Animated.ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + GLASS_HEADER_HEIGHT + 8,
            paddingBottom: insets.bottom + 120,
          },
        ]}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
      >
        {/* Stats Grid */}
        <View style={styles.sectionHeaderRow}>
          <AppText
            variant="h3"
            style={[styles.sectionTitle, { color: theme.text }]}
          >
            Aperçu
          </AppText>
          <TouchableOpacity
            accessible
            accessibilityRole="button"
            onPress={() => setIsEditing((prev) => !prev)}
            accessibilityLabel="Personnaliser le tableau de bord"
            accessibilityHint="Active le mode édition des widgets"
            style={[styles.gearButton, styles.gearButtonInactive]}
            testID="club-dashboard-edit-widgets-button"
          >
            <SettingsIcon size={18} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
        <View style={styles.grid}>
          {widgets
            .filter((w) => w.visible)

            .map((w) => {
              const def = DEFAULT_CLUB_DASHBOARD_WIDGETS.find(
                (d) => d.id === w.id,
              );
              if (!def) return null;

              if (
                def.id === "registrations" &&
                registrationMode !== "CLUB_AND_MEMBERS_PENDING"
              ) {
                return null;
              }

              const onPress =
                def.id === "members"
                  ? () => navigateTo("ClubMembers")
                  : def.id === "competitions"
                    ? () => navigateTo("ClubCompetitions")
                    : def.id === "registrations"
                      ? () => navigateTo("ClubRegistrations")
                      : def.id === "couples"
                        ? () => navigateTo("ClubCouples")
                        : () => navigateTo("ClubSoloTeams");

              const value =
                def.id === "members"
                  ? stats.members
                  : def.id === "competitions"
                    ? stats.activeCompetitions
                    : def.id === "registrations"
                      ? stats.pendingRegistrations
                      : def.id === "couples"
                        ? "-"
                        : "-";

              const testIDMap: Partial<Record<ClubDashboardWidgetId, string>> =
                {
                  members: "club-dashboard-members-card",
                  competitions: "club-dashboard-competitions-card",
                  registrations: "club-dashboard-registrations-card",
                };

              const hintMap: Record<ClubDashboardWidgetId, string> = {
                members: "Ouvre la liste des membres du club",
                competitions: "Ouvre la liste des compétitions",
                registrations: "Ouvre les inscriptions en attente",
                couples: "Ouvre la gestion des couples",
                soloTeams: "Ouvre la gestion des équipes solo",
              };

              return (
                <StatCard
                  key={def.id}
                  icon={def.icon}
                  label={def.label}
                  value={value}
                  color={def.color}
                  onPress={onPress}
                  testID={testIDMap[def.id]}
                  theme={theme}
                  iconSize={def.id === "soloTeams" ? 30 : undefined}
                  accessibilityHint={hintMap[def.id]}
                />
              );
            })}
        </View>

        {/* Quick Actions */}
        <AppText
          variant="h3"
          style={[styles.sectionTitleWithMargin, { color: theme.text }]}
        >
          Gestion
        </AppText>

        <MenuRow
          icon={Trophy}
          label="Événements"
          subtitle="Gérer les événements et résultats"
          color="#2196F3"
          onPress={() => navigateTo("ClubCompetitions")}
          testID="club-dashboard-competitions-row"
          theme={theme}
          accessibilityHint="Ouvre la gestion des compétitions"
        />

        <MenuRow
          icon={User}
          label="Gestion des Membres"
          subtitle="Ajouter, modifier, supprimer"
          color="#4CAF50"
          onPress={() => navigateTo("ClubMembers")}
          testID="club-dashboard-members-row"
          theme={theme}
          accessibilityHint="Ouvre la gestion des membres"
        />

        <MenuRow
          icon={Users}
          label="Couples"
          subtitle="Créer et gérer les partenariats"
          color="#E91E63"
          onPress={() => navigateTo("ClubCouples")}
          testID="club-dashboard-couples-row"
          theme={theme}
          accessibilityHint="Ouvre la gestion des couples"
        />

        <MenuRow
          icon={UsersRound}
          label="Solo Teams"
          subtitle="Équipes de danse en ligne"
          color="#9C27B0"
          onPress={() => navigateTo("ClubSoloTeams")}
          testID="club-dashboard-soloteams-row"
          theme={theme}
          iconSize={24}
          accessibilityHint="Ouvre la gestion des équipes solo"
        />

        {registrationMode === "CLUB_AND_MEMBERS_PENDING" && (
          <MenuRow
            icon={ClipboardList}
            label="Inscriptions en attente"
            subtitle={
              stats.pendingRegistrations > 0
                ? `${stats.pendingRegistrations} demandes à valider`
                : "Aucune demande"
            }
            color="#FF9800"
            onPress={() => navigateTo("ClubRegistrations")}
            testID="club-dashboard-registrations-row"
            theme={theme}
            accessibilityHint="Ouvre les inscriptions en attente de validation"
          />
        )}
      </Animated.ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
  },
  statCard: {
    width: CARD_WIDTH,
    padding: 16,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  menuLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  menuIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  statValue: {
    marginTop: 12,
  },
  statLabel: {
    marginTop: 4,
  },
  menuLabel: {
    fontWeight: "600",
  },
  sectionTitle: {
    marginBottom: 0,
  },
  sectionTitleWithMargin: {
    marginTop: 24,
    marginBottom: 16,
  },
  gearButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 999,
  },
  editContainer: {
    borderRadius: 16,
    overflow: "hidden",
  },
  editItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  editItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  visibilityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  gearButtonInactive: {
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
});
