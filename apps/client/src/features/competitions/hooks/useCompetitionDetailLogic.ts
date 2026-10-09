import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
} from "../../../constants/errorMessages";
import { RootStackParamList } from "../../../navigation/types";
import { createLogger } from "../../../utils/logger";
import {
  cancelDeadlineNotificationForCompetition,
  clearDeadlineMarker,
} from "../../../utils/scheduleDeadlineNotification";
import { useAuthRepository, UserRole } from "../../auth/context/AuthContext";
import { AuthConfig } from "../../auth/services/AuthService";
import { useClubRepository } from "../../club/context/ClubContext";
import {
  ClubPendingRegistration,
  CompetitionRegistration,
  Event,
  useCompetitionRepository,
} from "../context/CompetitionContext";
import {
  ClubService,
  type ClubRegistrationMode,
} from "../../club/services/ClubService";
import { useOfflineQueueStore } from "../../../stores/offlineQueue.store";
import type { CompetitionLevelProfile } from "../../../utils/competitionLevel";
import { evaluateLocalEligibility } from "../utils/localEligibility";
import {
  applyPendingRegistrations,
  getPendingRegistrationActions,
  QUEUE_MESSAGES,
  RegistrationDeadlinePassedError,
  submitRegistrationAction,
  type RegistrationAction,
  type SubmitOutcome,
} from "../services/registrationQueue";

const logger = createLogger("useCompetitionDetailLogic");

type CompetitionDetailScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "CompetitionDetail"
>;

export const useCompetitionDetailLogic = (
  competitionId: string,
  navigation: CompetitionDetailScreenNavigationProp,
) => {
  const {
    getCompetitionDetails,
    getCompetitionDetailsForUser,
    registerForEvent,
    unregisterFromEvent,
    getUserRegistrations,
    getClubPendingRegistrations,
    registerMember,
    confirmRegistration,
    unregisterMember,
  } = useCompetitionRepository();
  const auth = useAuthRepository();
  const clubRepository = useClubRepository();

  const queryClient = useQueryClient();

  /** Stored session + per-discipline levels (from /users/me) for the local eligibility fallback. */
  const [userProfile, setUserProfile] = useState<
    (AuthConfig & CompetitionLevelProfile) | null
  >(null);
  const [userRole, setUserRole] = useState<UserRole>("GUEST");
  const [selectedEventForRegistration, setSelectedEventForRegistration] =
    useState<Event | null>(null);
  /** Épreuve en couple : modal pour saisir le nom du partenaire avant inscription */
  const [partnerInputEvent, setPartnerInputEvent] = useState<Event | null>(
    null,
  );

  // Queries — pour un licencié, on charge le détail avec éligibilité serveur (GET /for-user)
  const {
    data: details,
    isLoading: isDetailsLoading,
    isError: isDetailsError,
  } = useQuery({
    queryKey: ["competition", competitionId, userRole],
    queryFn: () =>
      userRole === "LICENSEE" && getCompetitionDetailsForUser
        ? getCompetitionDetailsForUser(competitionId)
        : getCompetitionDetails(competitionId),
    enabled: !!competitionId,
  });

  useEffect(() => {
    if (isDetailsError) {
      Alert.alert("Erreur", ERROR_MESSAGES.COMPETITION_LOAD_FAILED);
      navigation.goBack();
    }
  }, [isDetailsError, navigation]);

  const { data: myRegistrationsRaw, isLoading: isRegLoading } = useQuery({
    queryKey: ["myRegistrations"],
    queryFn: () => getUserRegistrations(),
    enabled: userRole !== "GUEST" && userRole !== "CLUB",
  });

  // Offline queue (#416): actions waiting for the network are overlaid on
  // the server list, so the UI shows them as done ("En attente de réseau")
  // and rolls back by itself when a replay is rejected (entry removed).
  const queuedItems = useOfflineQueueStore((s) => s.items);
  const pendingRegistrationActions = useMemo(
    () => getPendingRegistrationActions(queuedItems, competitionId),
    [queuedItems, competitionId],
  );
  const myRegistrations = useMemo(
    () =>
      applyPendingRegistrations(
        myRegistrationsRaw?.map((r) => r.eventId) ?? [],
        pendingRegistrationActions,
      ),
    [myRegistrationsRaw, pendingRegistrationActions],
  );

  const { data: clubMembers = [], isLoading: isClubMembersLoading } = useQuery({
    queryKey: ["clubMembers"],
    queryFn: () => clubRepository.getMembers(),
    enabled: userRole === "CLUB",
  });

  const { data: clubRegistrationMode, isLoading: isClubModeLoading } = useQuery(
    {
      queryKey: ["clubRegistrationMode"],
      queryFn: () =>
        ClubService.getHelloAssoStatus().then(
          (r) => r.registrationMode ?? "MEMBERS_AUTO_CONFIRM",
        ),
      enabled: userRole === "CLUB",
    },
  );

  const { data: myClubRegistrationMode } = useQuery({
    queryKey: ["myClubRegistrationMode"],
    queryFn: () =>
      ClubService.getMyClubRegistrationMode().then((r) => r.registrationMode),
    enabled: userRole !== "GUEST" && userRole !== "CLUB",
  });

  const { data: clubPendingRegistrations = [], isLoading: isPendingLoading } =
    useQuery({
      queryKey: ["clubPendingRegistrations"],
      queryFn: () => getClubPendingRegistrations(),
      enabled: userRole === "CLUB",
    });

  const pendingRegistrationsForCompetition = clubPendingRegistrations.filter(
    (r: ClubPendingRegistration) => r.event.competitionId === competitionId,
  );

  const canSelfRegister =
    myClubRegistrationMode === undefined
      ? undefined
      : myClubRegistrationMode !== "CLUB_ONLY";

  const isOrganizedByMyClub =
    userRole === "CLUB" &&
    !!userProfile?.clubName &&
    !!details?.organizer &&
    userProfile.clubName.trim().toLowerCase() ===
      String(details.organizer).trim().toLowerCase();

  const loading =
    isDetailsLoading ||
    isRegLoading ||
    isClubMembersLoading ||
    (userRole === "CLUB" && (isClubModeLoading || isPendingLoading));

  useEffect(() => {
    const loadProfileAndRole = async () => {
      try {
        const config = await auth.getAuthConfig();
        setUserRole(config.role);
        // Licencié : charger /users/me pour l'éligibilité locale — les niveaux
        // par discipline ne sont pas stockés dans la session, et category/
        // ageGroup peuvent manquer (ancien login).
        if (config.role === "LICENSEE") {
          try {
            const profile = await auth.getProfile();
            setUserProfile({
              ...config,
              category: profile.category ?? config.category,
              ageGroup: profile.ageGroup ?? config.ageGroup,
              competitionLevelLatin: profile.competitionLevelLatin,
              competitionLevelStandard: profile.competitionLevelStandard,
              competitionLevel: profile.competitionLevel,
            });
          } catch {
            setUserProfile(config);
          }
        } else {
          setUserProfile(config);
        }
      } catch (error) {
        logger.error("Error loading profile/role", error);
      }
    };
    loadProfileAndRole().catch(() => {});
  }, [auth]);

  const isEligible = useCallback(
    (event: Event) => {
      if (userRole === "GUEST") return { eligible: false, reason: "GUEST" };
      // Si l’API a renvoyé l’éligibilité (GET /for-user), on l’utilise en priorité
      if (event.eligibility != null) {
        return {
          eligible: event.eligibility.eligible,
          reason: event.eligibility.reason,
        };
      }
      if (!userProfile) return { eligible: false, reason: "LOADING" };

      // Same discipline rule as the backend (Ten Dance = both disciplines).
      return evaluateLocalEligibility(event, userProfile);
    },
    [userRole, userProfile],
  );

  /**
   * The action did not reach the server (queued, collapsed or duplicate):
   * restore the server cache — the queue overlay is the only pending source,
   * which keeps rollback exact if the replay is rejected later.
   */
  const onQueuedOutcome = (
    action: RegistrationAction,
    outcome: SubmitOutcome,
    previousRegistrations: CompetitionRegistration[] | undefined,
  ) => {
    queryClient.setQueryData(["myRegistrations"], previousRegistrations);
    if (outcome.status === "queued") {
      Alert.alert(
        QUEUE_MESSAGES.QUEUED_TITLE,
        action === "register"
          ? QUEUE_MESSAGES.QUEUED_REGISTER
          : QUEUE_MESSAGES.QUEUED_UNREGISTER,
      );
    } else if (outcome.status === "collapsed") {
      Alert.alert(QUEUE_MESSAGES.COLLAPSED_TITLE, QUEUE_MESSAGES.COLLAPSED);
    } else {
      Alert.alert(QUEUE_MESSAGES.QUEUED_TITLE, QUEUE_MESSAGES.DUPLICATE);
    }
  };

  // Mutations
  const registerMutation = useMutation({
    mutationFn: ({
      eventId,
      partnerName,
    }: {
      eventId: string;
      partnerName?: string;
    }) =>
      submitRegistrationAction(
        "register",
        {
          competitionId,
          eventId,
          partnerName,
          registrationDeadline: details?.registrationDeadline,
        },
        () => registerForEvent(competitionId, eventId, partnerName),
        useOfflineQueueStore.getState().items,
      ),
    onMutate: async ({ eventId }) => {
      await queryClient.cancelQueries({ queryKey: ["myRegistrations"] });
      const previousRegistrations =
        queryClient.getQueryData<CompetitionRegistration[]>([
          "myRegistrations",
        ]) ?? [];
      queryClient.setQueryData<CompetitionRegistration[]>(
        ["myRegistrations"],
        [...previousRegistrations, { eventId } as CompetitionRegistration],
      );
      return { previousRegistrations };
    },
    onError: (err, _variables, context) => {
      queryClient.setQueryData(
        ["myRegistrations"],
        context?.previousRegistrations,
      );
      if (err instanceof RegistrationDeadlinePassedError) {
        Alert.alert(
          QUEUE_MESSAGES.DEADLINE_TITLE,
          QUEUE_MESSAGES.DEADLINE_PASSED,
        );
        return;
      }
      Alert.alert("Erreur", ERROR_MESSAGES.REGISTRATION_FAILED);
    },
    onSettled: () => {
      queryClient
        .invalidateQueries({ queryKey: ["myRegistrations"] })
        .catch(() => {});
    },
    onSuccess: (outcome, _variables, context) => {
      if (outcome.status !== "sent") {
        onQueuedOutcome("register", outcome, context.previousRegistrations);
        return;
      }
      // Inscrit → le rappel de deadline devient du bruit : annule + marque
      // pour empêcher une replanification à la prochaine visite (#300).
      void cancelDeadlineNotificationForCompetition(competitionId);
      Alert.alert("Succès", SUCCESS_MESSAGES.REGISTRATION_SUCCESS);
    },
  });

  const unregisterMutation = useMutation({
    mutationFn: (eventId: string) =>
      submitRegistrationAction(
        "unregister",
        { competitionId, eventId },
        () => unregisterFromEvent(competitionId, eventId),
        useOfflineQueueStore.getState().items,
      ),
    onMutate: async (eventId) => {
      await queryClient.cancelQueries({ queryKey: ["myRegistrations"] });
      const previousRegistrations =
        queryClient.getQueryData<CompetitionRegistration[]>([
          "myRegistrations",
        ]) ?? [];
      queryClient.setQueryData<CompetitionRegistration[]>(
        ["myRegistrations"],
        previousRegistrations.filter((r) => r.eventId !== eventId),
      );
      return { previousRegistrations };
    },
    onError: (_err, _eventId, context) => {
      queryClient.setQueryData(
        ["myRegistrations"],
        context?.previousRegistrations,
      );
      Alert.alert("Erreur", ERROR_MESSAGES.UNREGISTRATION_FAILED);
    },
    onSettled: () => {
      queryClient
        .invalidateQueries({ queryKey: ["myRegistrations"] })
        .catch(() => {});
    },
    onSuccess: (outcome, _eventId, context) => {
      if (outcome.status !== "sent") {
        onQueuedOutcome("unregister", outcome, context.previousRegistrations);
        return;
      }
      // Désinscrit → retire le marqueur "inscrit" pour qu'une future visite
      // replanifie le rappel de deadline (#300).
      void clearDeadlineMarker(competitionId);
      Alert.alert("Succès", SUCCESS_MESSAGES.UNREGISTRATION_SUCCESS);
    },
  });

  const registerMemberMutation = useMutation({
    mutationFn: ({
      eventId,
      userId,
      partnerName,
    }: {
      eventId: string;
      userId: string;
      partnerName?: string;
    }) => registerMember(eventId, userId, partnerName),
    onSuccess: () => {
      queryClient
        .invalidateQueries({
          queryKey: ["clubPendingRegistrations"],
        })
        .catch(() => {});
      queryClient
        .invalidateQueries({
          queryKey: ["competition", competitionId],
        })
        .catch(() => {});
      setSelectedEventForRegistration(null);
      Alert.alert("Succès", "Membre(s) inscrit(s).");
    },
    onError: () => Alert.alert("Erreur", "Impossible d’inscrire le membre."),
  });

  const confirmRegistrationMutation = useMutation({
    mutationFn: (registrationId: string) => confirmRegistration(registrationId),
    onSuccess: () => {
      queryClient
        .invalidateQueries({
          queryKey: ["clubPendingRegistrations"],
        })
        .catch(() => {});
      queryClient
        .invalidateQueries({
          queryKey: ["competition", competitionId],
        })
        .catch(() => {});
      Alert.alert("Succès", "Inscription validée.");
    },
    onError: () => Alert.alert("Erreur", "Impossible de valider."),
  });

  const unregisterMemberMutation = useMutation({
    mutationFn: ({ eventId, userId }: { eventId: string; userId: string }) =>
      unregisterMember(eventId, userId),
    onSuccess: () => {
      queryClient
        .invalidateQueries({
          queryKey: ["clubPendingRegistrations"],
        })
        .catch(() => {});
      queryClient
        .invalidateQueries({
          queryKey: ["competition", competitionId],
        })
        .catch(() => {});
      Alert.alert("Succès", "Membre désinscrit.");
    },
    onError: () => Alert.alert("Erreur", "Impossible de désinscrire."),
  });

  const handleRegister = (event: Event) => {
    if (userRole === "CLUB") {
      setSelectedEventForRegistration(event);
      return;
    }
    const isCoupleEvent = event.eventType === "COUPLE" || !event.eventType;
    if (isCoupleEvent) {
      setPartnerInputEvent(event);
      return;
    }
    registerMutation.mutate({ eventId: event.id });
  };

  const handleConfirmPartnerRegistration = (partnerName: string) => {
    if (!partnerInputEvent?.id) return;
    const trimmed = partnerName.trim();
    if (!trimmed) {
      Alert.alert("Erreur", "Indiquez le nom de votre partenaire.");
      return;
    }
    registerMutation.mutate({
      eventId: partnerInputEvent.id,
      partnerName: trimmed,
    });
    setPartnerInputEvent(null);
  };

  const clearPartnerInput = () => setPartnerInputEvent(null);

  const handleUnregister = (event: Event) => {
    unregisterMutation.mutate(event.id);
  };

  const handleRegisterMembers = async (
    memberIds: string[],
    partnerName?: string,
  ) => {
    const event = selectedEventForRegistration;
    if (!event || memberIds.length === 0) return;
    for (const userId of memberIds) {
      await registerMemberMutation.mutateAsync({
        eventId: event.id,
        userId,
        partnerName,
      });
    }
  };

  const handleConfirmRegistration = (registrationId: string) => {
    confirmRegistrationMutation.mutate(registrationId);
  };

  const handleUnregisterMember = (eventId: string, userId: string) => {
    unregisterMemberMutation.mutate({ eventId, userId });
  };

  const showPendingSection =
    userRole === "CLUB" &&
    (clubRegistrationMode as ClubRegistrationMode) ===
      "CLUB_AND_MEMBERS_PENDING" &&
    pendingRegistrationsForCompetition.length > 0;

  return {
    state: {
      details,
      loading,
      myRegistrations,
      pendingRegistrationActions,
      userRole,
      clubMembers,
      selectedEventForRegistration,
      partnerInputEvent,
      isGuest: userRole === "GUEST",
      clubRegistrationMode,
      pendingRegistrationsForCompetition,
      showPendingSection,
      isRegisteringMembers: registerMemberMutation.isPending,
      canSelfRegister,
      isOrganizedByMyClub,
    },
    actions: {
      handleRegister,
      handleUnregister,
      isEligible,
      setSelectedEventForRegistration,
      handleConfirmPartnerRegistration,
      clearPartnerInput,
      handleRegisterMembers,
      handleConfirmRegistration,
      handleUnregisterMember,
    },
  };
};
