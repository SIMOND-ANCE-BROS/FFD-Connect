/* eslint-disable react-native-a11y/has-valid-accessibility-descriptors -- TODO: add a11y descriptors to couple list items */
import { useNavigation } from "@react-navigation/native";
import { Plus, Users } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, TouchableOpacity, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppText } from "../../../components/AppText";
import { BackButton } from "../../../components/BackButton";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { SearchBar } from "../../../components/SearchBar";
import { useTheme } from "../../../context/ThemeContext";
import { useAuthRepository } from "../../auth/context/AuthContext";
import { CoupleCard } from "../components/couples/CoupleCard";
import { CreateCoupleModal } from "../components/couples/CreateCoupleModal";
import { EndCoupleModal } from "../components/couples/EndCoupleModal";
import { styles } from "../components/couples/club-couples.styles";
import { ClubService, type Partnership } from "../services/ClubService";

type Tab = "active" | "history";

export const ClubCouplesScreen = () => {
  const auth = useAuthRepository();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("active");
  const [coupleSearchQuery, setCoupleSearchQuery] = useState("");
  const [headerH, setHeaderH] = useState(insets.top + 120);
  const [primaryClubName, setPrimaryClubName] = useState<string>("Mono-club");
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [endModalVisible, setEndModalVisible] = useState(false);
  const [clubPickerVisible, setClubPickerVisible] = useState(false);
  const [selectedPartnership, setSelectedPartnership] =
    useState<Partnership | null>(null);
  const [endDate, setEndDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<string[]>([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [selectedSecondaryClubId, setSelectedSecondaryClubId] = useState<
    string | null
  >(null);

  const activeOnly = tab === "active";
  const { data: partnershipsData, isLoading } = useQuery({
    queryKey: ["clubPartnerships", activeOnly],
    queryFn: () => ClubService.getPartnerships(activeOnly),
  });
  const partnerships = partnershipsData?.partnerships ?? [];
  const myClubId = partnershipsData?.myClubId ?? null;

  const filteredPartnerships = React.useMemo(() => {
    const q = coupleSearchQuery.trim().toLowerCase();
    if (!q) return partnerships;
    return partnerships.filter((p) => {
      const n1 = `${p.user1.firstName} ${p.user1.lastName}`.toLowerCase();
      const n2 = `${p.user2.firstName} ${p.user2.lastName}`.toLowerCase();
      return n1.includes(q) || n2.includes(q);
    });
  }, [partnerships, coupleSearchQuery]);

  const { data: activePartnershipsData } = useQuery({
    queryKey: ["clubPartnerships", true],
    queryFn: () => ClubService.getPartnerships(true),
    enabled: createModalVisible,
  });
  const activePartnershipsForModal = activePartnershipsData?.partnerships ?? [];

  const { data: clubsForPartnership = [] } = useQuery({
    queryKey: ["clubPartnershipClubs"],
    queryFn: () => ClubService.getClubsForPartnership(),
    enabled: createModalVisible,
  });

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: [
      "clubMembersForPartnership",
      selectedSecondaryClubId ?? "primary",
    ],
    queryFn: () =>
      selectedSecondaryClubId
        ? ClubService.getMembersForPartnership(selectedSecondaryClubId)
        : ClubService.getMembers({ take: 100 }),
    enabled: createModalVisible,
  });

  const inActiveCoupleIds = React.useMemo(
    () =>
      new Set(
        activePartnershipsForModal.flatMap((p) => [p.user1Id, p.user2Id]),
      ),
    [activePartnershipsForModal],
  );
  const availableMembers = React.useMemo(
    () => members.filter((m) => !inActiveCoupleIds.has(m.id)),
    [members, inActiveCoupleIds],
  );

  const filteredMembers = React.useMemo(() => {
    const q = memberSearchQuery.trim().toLowerCase();
    if (!q) return availableMembers;
    return availableMembers.filter((m) => {
      const first = m.firstName.toLowerCase();
      const last = m.lastName.toLowerCase();
      const licenseNum = (m.license?.number ?? "").toLowerCase();
      const fullName = `${first} ${last}`;
      const fullNameReverse = `${last} ${first}`;
      return (
        fullName.includes(q) ||
        fullNameReverse.includes(q) ||
        first.includes(q) ||
        last.includes(q) ||
        licenseNum.includes(q)
      );
    });
  }, [availableMembers, memberSearchQuery]);

  const refresh = useCallback(() => {
    queryClient
      .invalidateQueries({ queryKey: ["clubPartnerships"] })
      .catch(() => {});
  }, [queryClient]);

  React.useEffect(() => {
    let isMounted = true;
    const loadClubName = async () => {
      try {
        const config = await auth.getAuthConfig();
        if (!isMounted) return;
        if (config.clubName?.trim()) {
          setPrimaryClubName(config.clubName.trim());
        } else {
          setPrimaryClubName("Mon club");
        }
      } catch {
        if (!isMounted) return;
        setPrimaryClubName("Mon club");
      }
    };
    loadClubName().catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [auth]);

  const handleCreatePartnership = async () => {
    if (
      selectedPartnerIds.length !== 2 ||
      selectedPartnerIds[0] === selectedPartnerIds[1]
    ) {
      Alert.alert("Erreur", "Choisissez exactement deux partenaires.");
      return;
    }
    const [user1Id, user2Id] = selectedPartnerIds;
    const payload: {
      user1Id: string;
      user2Id: string;
      secondaryClubId?: string;
    } = { user1Id, user2Id };
    if (selectedSecondaryClubId)
      payload.secondaryClubId = selectedSecondaryClubId;
    try {
      const res = await ClubService.createPartnership(payload);
      setCreateModalVisible(false);
      setClubPickerVisible(false);
      setSelectedPartnerIds([]);
      setSelectedSecondaryClubId(null);
      setMemberSearchQuery("");
      refresh();
      const ageLabel =
        res.coupleAgeGroup ?? "Non calculée (dates de naissance requises)";
      const levelLabel = res.suggestedLevel ?? "—";
      const catLabel = res.suggestedCategories.length
        ? res.suggestedCategories.join(", ")
        : "—";
      const msg =
        res.partnership.status === "PENDING_SECOND_CLUB"
          ? `Couple créé. En attente de validation par le club partenaire.\n\nClasse d'âge : ${ageLabel}\nNiveau conseillé : ${levelLabel}\nTypes de danse : ${catLabel}`
          : `Couple créé.\nClasse d'âge : ${ageLabel}\nNiveau conseillé : ${levelLabel}\nTypes de danse : ${catLabel}`;
      Alert.alert("Couple créé", msg);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } }).response
        ?.data?.message;
      Alert.alert("Erreur", msg ?? "Impossible de créer le couple.");
    }
  };

  const handleEndPartnership = async () => {
    if (!selectedPartnership) return;
    try {
      await ClubService.endPartnership(selectedPartnership.id, endDate);
      setEndModalVisible(false);
      setSelectedPartnership(null);
      refresh();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } }).response
        ?.data?.message;
      Alert.alert("Erreur", msg ?? "Impossible de clôturer le partenariat.");
    }
  };

  const openEndModal = (p: Partnership) => {
    setSelectedPartnership(p);
    setEndDate(new Date().toISOString().slice(0, 10));
    setEndModalVisible(true);
  };

  const togglePartner = (id: string) => {
    setSelectedPartnerIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  };

  const handleValidatePartnership = async (
    partnershipId: string,
    accepted: boolean,
  ) => {
    try {
      await ClubService.validatePartnership(partnershipId, accepted);
      refresh();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } }).response
        ?.data?.message;
      Alert.alert("Erreur", msg ?? "Action impossible.");
    }
  };

  const handleValidatePartnershipSync = useCallback(
    (partnershipId: string, accepted: boolean) => {
      handleValidatePartnership(partnershipId, accepted).catch(() => {});
    },
    [],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {isLoading ? (
        <View style={[styles.centered, { paddingTop: headerH + 8 }]}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <FlashList
          data={filteredPartnerships}
          keyExtractor={(p) => p.id}
          onRefresh={refresh}
          refreshing={isLoading}
          contentContainerStyle={[
            styles.listContent,
            { paddingTop: headerH + 8, paddingBottom: insets.bottom + 100 },
          ]}
          renderItem={({ item }) => (
            <CoupleCard
              theme={theme}
              item={item}
              activeOnly={activeOnly}
              myClubId={myClubId}
              onEnd={openEndModal}
              onValidate={handleValidatePartnershipSync}
            />
          )}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Users size={48} color={theme.textSecondary} />
              <AppText
                variant="body"
                style={[styles.mt12, { color: theme.textSecondary }]}
              >
                {coupleSearchQuery.trim()
                  ? "Aucun couple trouvé"
                  : activeOnly
                    ? "Aucun couple actif"
                    : "Aucun historique"}
              </AppText>
            </View>
          }
        />
      )}

      <PinnedHeader
        theme={theme}
        isDark={isDark}
        title="Couples"
        left={<BackButton onPress={() => navigation.goBack()} />}
        onHeightChange={setHeaderH}
      >
        {/* Recherche AU-DESSUS des filtres, comme partout ailleurs dans l'app. */}
        <SearchBar
          value={coupleSearchQuery}
          onChangeText={setCoupleSearchQuery}
          placeholder="Rechercher un couple…"
          testID="club-couples-search"
        />
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[
              styles.tab,
              tab === "active" && { backgroundColor: theme.primary },
            ]}
            onPress={() => setTab("active")}
          >
            <AppText
              variant="button"
              style={
                tab === "active"
                  ? styles.textWhite
                  : { color: theme.textSecondary }
              }
            >
              Actifs
            </AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.tab,
              tab === "history" && { backgroundColor: theme.primary },
            ]}
            onPress={() => setTab("history")}
          >
            <AppText
              variant="button"
              style={
                tab === "history"
                  ? styles.textWhite
                  : { color: theme.textSecondary }
              }
            >
              Historique
            </AppText>
          </TouchableOpacity>
        </View>
      </PinnedHeader>

      {tab === "active" && (
        <TouchableOpacity
          style={[
            styles.fab,
            { backgroundColor: theme.primary, bottom: insets.bottom + 20 },
          ]}
          onPress={() => setCreateModalVisible(true)}
        >
          <Plus size={24} color="#FFF" />
          <AppText variant="button" style={[styles.textWhite, styles.ml8]}>
            Créer un couple
          </AppText>
        </TouchableOpacity>
      )}

      <CreateCoupleModal
        theme={theme}
        visible={createModalVisible}
        onClose={() => {
          setCreateModalVisible(false);
          setClubPickerVisible(false);
          setSelectedPartnerIds([]);
          setMemberSearchQuery("");
          setSelectedSecondaryClubId(null);
        }}
        clubsForPartnership={clubsForPartnership}
        primaryClubName={primaryClubName}
        selectedSecondaryClubId={selectedSecondaryClubId}
        setSelectedSecondaryClubId={setSelectedSecondaryClubId}
        clubPickerVisible={clubPickerVisible}
        setClubPickerVisible={setClubPickerVisible}
        availableMembers={availableMembers}
        filteredMembers={filteredMembers}
        membersLoading={membersLoading}
        memberSearchQuery={memberSearchQuery}
        setMemberSearchQuery={setMemberSearchQuery}
        selectedPartnerIds={selectedPartnerIds}
        togglePartner={togglePartner}
        handleCreatePartnership={() => {
          handleCreatePartnership().catch(() => {});
        }}
      />

      <EndCoupleModal
        theme={theme}
        visible={endModalVisible}
        selectedPartnership={selectedPartnership}
        endDate={endDate}
        setEndDate={setEndDate}
        onClose={() => {
          setEndModalVisible(false);
          setSelectedPartnership(null);
        }}
        onEnd={() => {
          handleEndPartnership().catch(() => {});
        }}
      />
    </View>
  );
};
