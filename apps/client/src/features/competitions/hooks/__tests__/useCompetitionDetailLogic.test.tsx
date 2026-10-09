import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useOfflineQueueStore } from "../../../../stores/offlineQueue.store";
import { QUEUE_MESSAGES } from "../../services/registrationQueue";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
import { ERROR_MESSAGES } from "../../../../constants/errorMessages";
import { useAuthRepository } from "../../../../features/auth/context/AuthContext";
import { useClubRepository } from "../../../../features/club/context/ClubContext";
import { createPartialEvent } from "../../../../hooks/__mocks__/types";
import { useCompetitionRepository } from "../../context/CompetitionContext";
import { useCompetitionDetailLogic } from "../useCompetitionDetailLogic";

// Mock dependencies
jest.mock("../../../../features/auth/context/AuthContext", () => ({
  useAuthRepository: jest.fn(),
  UserRole: { LICENSEE: "LICENSEE", CLUB: "CLUB", GUEST: "GUEST" },
}));

jest.mock("../../context/CompetitionContext", () => ({
  useCompetitionRepository: jest.fn(),
}));

jest.mock("../../../../features/club/context/ClubContext", () => ({
  useClubRepository: jest.fn(),
}));

jest.mock("../../../../features/club/services/ClubService", () => ({
  ClubService: {
    getHelloAssoStatus: jest
      .fn()
      .mockResolvedValue({ registrationMode: "MEMBERS_AUTO_CONFIRM" }),
    getMyClubRegistrationMode: jest
      .fn()
      .mockResolvedValue({ registrationMode: "MEMBERS_AUTO_CONFIRM" }),
  },
}));

jest.spyOn(Alert, "alert");

afterAll(() => {
  // Drain any pending React scheduler setImmediate handles left after
  // renderHook calls. We clear without restoring real timers so any
  // callbacks queued after this point are silently dropped.
  jest.useFakeTimers();
  jest.clearAllTimers();
});

describe("useCompetitionDetailLogic", () => {
  const mockNavigation = { goBack: jest.fn() };
  const mockCompetitionId = "comp-1";

  const mockGetCompetitionDetails = jest.fn();
  const mockGetCompetitionDetailsForUser = jest.fn();
  const mockRegisterForEvent = jest.fn();
  const mockUnregisterFromEvent = jest.fn();
  const mockGetUserRegistrations = jest.fn();
  const mockGetClubPendingRegistrations = jest.fn();
  const mockRegisterMember = jest.fn();
  const mockConfirmRegistration = jest.fn();
  const mockUnregisterMember = jest.fn();
  const mockGetAuthConfig = jest.fn();
  const mockGetMembers = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    (useCompetitionRepository as jest.Mock).mockReturnValue({
      getCompetitionDetails: mockGetCompetitionDetails,
      getCompetitionDetailsForUser: mockGetCompetitionDetailsForUser,
      registerForEvent: mockRegisterForEvent,
      unregisterFromEvent: mockUnregisterFromEvent,
      getUserRegistrations: mockGetUserRegistrations,
      getClubPendingRegistrations: mockGetClubPendingRegistrations,
      registerMember: mockRegisterMember,
      confirmRegistration: mockConfirmRegistration,
      unregisterMember: mockUnregisterMember,
    });

    // Stable reference to prevent infinite useEffect([auth]) re-runs
    const stableAuth = { getAuthConfig: mockGetAuthConfig };
    (useAuthRepository as jest.Mock).mockReturnValue(stableAuth);

    (useClubRepository as jest.Mock).mockReturnValue({
      getMembers: mockGetMembers,
      checkEligibility: jest.fn(),
    });

    mockGetAuthConfig.mockResolvedValue({
      role: "LICENSEE",
      category: "A",
      ageGroup: "Adulte",
    });

    mockGetCompetitionDetails.mockResolvedValue({
      id: mockCompetitionId,
      name: "Test Competition",
      events: [{ id: "evt-1", name: "Event 1", category: "A" }],
    });

    mockGetCompetitionDetailsForUser.mockResolvedValue({
      id: mockCompetitionId,
      name: "Test Competition",
      events: [{ id: "evt-1", name: "Event 1", category: "A" }],
    });

    mockGetUserRegistrations.mockResolvedValue([]);
    mockGetClubPendingRegistrations.mockResolvedValue([]);
    mockRegisterForEvent.mockResolvedValue({});
    mockUnregisterFromEvent.mockResolvedValue({});
  });

  const createWrapper = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  describe("Initialization", () => {
    it("should load competition details on mount", async () => {
      const { result } = await renderHook(
        () =>
          useCompetitionDetailLogic(mockCompetitionId, mockNavigation as never),
        { wrapper: createWrapper() },
      );

      await waitFor(() => {
        expect(result.current.state.loading).toBe(false);
      });

      expect(result.current.state.details).not.toBeNull();
    });

    it("should handle error loading details", async () => {
      // Stay as GUEST so role never changes and only one query runs (the one that rejects)
      mockGetAuthConfig.mockResolvedValue({ role: "GUEST" });
      mockGetCompetitionDetails.mockRejectedValueOnce(new Error("Failed"));

      const { result } = await renderHook(
        () =>
          useCompetitionDetailLogic(mockCompetitionId, mockNavigation as never),
        { wrapper: createWrapper() },
      );

      await waitFor(() => {
        expect(result.current.state.loading).toBe(false);
        expect(Alert.alert).toHaveBeenCalledWith(
          "Erreur",
          ERROR_MESSAGES.COMPETITION_LOAD_FAILED,
        );
      });
      expect(mockNavigation.goBack).toHaveBeenCalled();
    });
  });

  describe("isEligible", () => {
    it("should return ineligible for GUEST", async () => {
      mockGetAuthConfig.mockResolvedValue({ role: "GUEST" });

      const { result } = await renderHook(
        () =>
          useCompetitionDetailLogic(mockCompetitionId, mockNavigation as never),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.state.loading).toBe(false));

      const eligibility = result.current.actions.isEligible(
        createPartialEvent({ id: "evt-1", category: "A" }),
      );
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.reason).toBe("GUEST");
    });

    it("should return ineligible for wrong category", async () => {
      mockGetAuthConfig.mockResolvedValue({ role: "LICENSEE", category: "B" });

      const { result } = await renderHook(
        () =>
          useCompetitionDetailLogic(mockCompetitionId, mockNavigation as never),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.state.loading).toBe(false));

      await waitFor(() => {
        const eligibility = result.current.actions.isEligible(
          createPartialEvent({ id: "evt-1", category: "A" }),
        );
        expect(eligibility.eligible).toBe(false);
        expect(eligibility.reason).toBe("WRONG_CATEGORY");
      });
    });

    it("should return eligible for matching category", async () => {
      // Use default beforeEach mock: { role: 'LICENSEE', category: 'A', ageGroup: 'Adulte' }

      const { result } = await renderHook(
        () =>
          useCompetitionDetailLogic(mockCompetitionId, mockNavigation as never),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.state.loading).toBe(false));

      await waitFor(() => {
        const eligibility = result.current.actions.isEligible(
          createPartialEvent({ id: "evt-1", category: "A" }),
        );
        expect(eligibility.eligible).toBe(true);
      });
    });

    it("tolerates legacy and canonical age-class spellings", async () => {
      // Default profile ageGroup is « Adulte ».
      const { result } = await renderHook(
        () =>
          useCompetitionDetailLogic(mockCompetitionId, mockNavigation as never),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.state.loading).toBe(false));

      await waitFor(() => {
        expect(
          result.current.actions.isEligible(
            createPartialEvent({
              id: "evt-1",
              category: "A",
              ageGroup: "Adult",
            }),
          ).eligible,
        ).toBe(true);
      });
      const senior = result.current.actions.isEligible(
        createPartialEvent({
          id: "evt-2",
          category: "A",
          ageGroup: "Senior II",
        }),
      );
      expect(senior.eligible).toBe(false);
      expect(senior.reason).toBe("WRONG_AGE_GROUP");
      expect(
        result.current.actions.isEligible(
          createPartialEvent({
            id: "evt-3",
            category: "A",
            ageGroup: "Espoir",
          }),
        ).eligible,
      ).toBe(true);
    });

    it("uses the per-discipline levels from /users/me (Ten Dance needs both)", async () => {
      mockGetAuthConfig.mockResolvedValue({
        role: "LICENSEE",
        category: "Latin",
        ageGroup: "Adulte",
      });
      const getProfile = jest.fn().mockResolvedValue({
        category: "Latin",
        ageGroup: "Adulte",
        competitionLevelLatin: "Avancé",
        competitionLevelStandard: null,
      });
      const auth = { getAuthConfig: mockGetAuthConfig, getProfile };
      (useAuthRepository as jest.Mock).mockReturnValue(auth);

      const { result } = await renderHook(
        () =>
          useCompetitionDetailLogic(mockCompetitionId, mockNavigation as never),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(getProfile).toHaveBeenCalled());
      await waitFor(() => {
        expect(
          result.current.actions.isEligible(
            createPartialEvent({ id: "evt-1", category: "Latin" }),
          ).eligible,
        ).toBe(true);
      });
      expect(
        result.current.actions.isEligible(
          createPartialEvent({ id: "evt-2", category: "Ten Dance" }),
        ),
      ).toEqual({ eligible: false, reason: "WRONG_CATEGORY" });

      getProfile.mockResolvedValue({
        category: "Latin",
        ageGroup: "Adulte",
        competitionLevelLatin: "Avancé",
        competitionLevelStandard: "Débutant",
      });
      const second = await renderHook(
        () =>
          useCompetitionDetailLogic(mockCompetitionId, mockNavigation as never),
        { wrapper: createWrapper() },
      );
      await waitFor(() => {
        expect(
          second.result.current.actions.isEligible(
            createPartialEvent({ id: "evt-2", category: "Ten Dance" }),
          ).eligible,
        ).toBe(true);
      });
    });
  });

  describe("handleRegister", () => {
    it("should register for an event", async () => {
      const { result } = await renderHook(
        () =>
          useCompetitionDetailLogic(mockCompetitionId, mockNavigation as never),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.state.loading).toBe(false));

      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await result.current.actions.handleRegister(
          createPartialEvent({ id: "evt-1", eventType: "SOLO" } as never),
        );
      });

      expect(mockRegisterForEvent).toHaveBeenCalledWith(
        "comp-1",
        "evt-1",
        undefined,
      );
      expect(Alert.alert).toHaveBeenCalledWith(
        "Succès",
        "Inscription confirmée",
      );
    });

    it("should handle registration error", async () => {
      mockRegisterForEvent.mockRejectedValueOnce(new Error("Failed"));

      const { result } = await renderHook(
        () =>
          useCompetitionDetailLogic(mockCompetitionId, mockNavigation as never),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.state.loading).toBe(false));

      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await result.current.actions.handleRegister(
          createPartialEvent({ id: "evt-1", eventType: "SOLO" } as never),
        );
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        "Erreur",
        "L'inscription a échoué",
      );
    });
  });

  describe("handleUnregister", () => {
    it("should unregister from an event", async () => {
      const { result } = await renderHook(
        () =>
          useCompetitionDetailLogic(mockCompetitionId, mockNavigation as never),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.state.loading).toBe(false));

      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await result.current.actions.handleUnregister(
          createPartialEvent({ id: "evt-1" }),
        );
      });

      expect(mockUnregisterFromEvent).toHaveBeenCalledWith("comp-1", "evt-1");
      expect(Alert.alert).toHaveBeenCalledWith(
        "Succès",
        "Désinscription confirmée",
      );
    });
  });

  describe("offline queue (#416)", () => {
    const soloEvent = () =>
      createPartialEvent({ id: "evt-1", eventType: "SOLO" } as never);

    beforeEach(async () => {
      await AsyncStorage.clear();
      useOfflineQueueStore.getState().setItems([]);
      (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
    });

    const setup = async () => {
      const hook = await renderHook(
        () =>
          useCompetitionDetailLogic(mockCompetitionId, mockNavigation as never),
        { wrapper: createWrapper() },
      );
      await waitFor(() =>
        expect(hook.result.current.state.loading).toBe(false),
      );
      return hook;
    };

    it("queues a register while offline and shows it as pending", async () => {
      (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
      const { result } = await setup();

      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await result.current.actions.handleRegister(soloEvent());
      });

      expect(mockRegisterForEvent).not.toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenCalledWith(
        QUEUE_MESSAGES.QUEUED_TITLE,
        QUEUE_MESSAGES.QUEUED_REGISTER,
      );
      await waitFor(() =>
        expect(result.current.state.pendingRegistrationActions).toEqual({
          "evt-1": "register",
        }),
      );
      expect(result.current.state.myRegistrations).toContain("evt-1");
    });

    it("queues on a network error instead of failing", async () => {
      mockRegisterForEvent.mockRejectedValueOnce(
        new AxiosError("Network Error", "ERR_NETWORK"),
      );
      const { result } = await setup();

      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await result.current.actions.handleRegister(soloEvent());
      });

      expect(mockRegisterForEvent).toHaveBeenCalledTimes(1);
      expect(Alert.alert).not.toHaveBeenCalledWith(
        "Erreur",
        ERROR_MESSAGES.REGISTRATION_FAILED,
      );
      await waitFor(() =>
        expect(result.current.state.pendingRegistrationActions).toEqual({
          "evt-1": "register",
        }),
      );
    });

    it("collapses register + unregister into a no-op", async () => {
      (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
      const { result } = await setup();

      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await result.current.actions.handleRegister(soloEvent());
      });
      await waitFor(() =>
        expect(result.current.state.myRegistrations).toContain("evt-1"),
      );
      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await result.current.actions.handleUnregister(soloEvent());
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        QUEUE_MESSAGES.COLLAPSED_TITLE,
        QUEUE_MESSAGES.COLLAPSED,
      );
      await waitFor(() =>
        expect(result.current.state.pendingRegistrationActions).toEqual({}),
      );
      expect(result.current.state.myRegistrations).not.toContain("evt-1");
      expect(mockUnregisterFromEvent).not.toHaveBeenCalled();
    });

    it("shows a pending unregister and rolls back when the replay is rejected", async () => {
      mockGetUserRegistrations.mockResolvedValue([{ eventId: "evt-1" }]);
      (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
      const { result } = await setup();
      await waitFor(() =>
        expect(result.current.state.myRegistrations).toEqual(["evt-1"]),
      );

      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await result.current.actions.handleUnregister(soloEvent());
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        QUEUE_MESSAGES.QUEUED_TITLE,
        QUEUE_MESSAGES.QUEUED_UNREGISTER,
      );
      await waitFor(() =>
        expect(result.current.state.myRegistrations).toEqual([]),
      );

      // Engine drops the entry after a rejected replay → overlay disappears.
      await act(async () => {
        useOfflineQueueStore.getState().setItems([]);
        await Promise.resolve();
      });
      await waitFor(() =>
        expect(result.current.state.myRegistrations).toEqual(["evt-1"]),
      );
    });

    it("says an action is already pending instead of enqueuing it twice", async () => {
      (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
      const { result } = await setup();

      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await result.current.actions.handleRegister(soloEvent());
      });
      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await result.current.actions.handleRegister(soloEvent());
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        QUEUE_MESSAGES.QUEUED_TITLE,
        QUEUE_MESSAGES.DUPLICATE,
      );
      expect(useOfflineQueueStore.getState().items).toHaveLength(1);
    });

    it("refuses an offline register after the deadline", async () => {
      mockGetCompetitionDetailsForUser.mockResolvedValue({
        id: mockCompetitionId,
        registrationDeadline: new Date(Date.now() - 86_400_000).toISOString(),
        events: [{ id: "evt-1", category: "A" }],
      });
      (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
      const { result } = await setup();
      await waitFor(() =>
        expect(result.current.state.details?.registrationDeadline).toBeTruthy(),
      );

      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await result.current.actions.handleRegister(soloEvent());
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        QUEUE_MESSAGES.DEADLINE_TITLE,
        QUEUE_MESSAGES.DEADLINE_PASSED,
      );
      expect(useOfflineQueueStore.getState().items).toHaveLength(0);
    });
  });

  describe("Organizer Flow", () => {
    it("should load club members for CLUB", async () => {
      mockGetAuthConfig.mockResolvedValue({ role: "CLUB" });
      mockGetMembers.mockResolvedValue([{ id: "m1", firstName: "Member 1" }]);

      const { result } = await renderHook(
        () =>
          useCompetitionDetailLogic(mockCompetitionId, mockNavigation as never),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.state.loading).toBe(false));

      expect(mockGetMembers).toHaveBeenCalled();
      expect(result.current.state.clubMembers).toHaveLength(1);
    });

    it("should set selected event for registration for CLUB", async () => {
      mockGetAuthConfig.mockResolvedValue({ role: "CLUB" });

      const { result } = await renderHook(
        () =>
          useCompetitionDetailLogic(mockCompetitionId, mockNavigation as never),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.state.loading).toBe(false));

      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await result.current.actions.handleRegister(
          createPartialEvent({ id: "evt-1" }),
        );
      });

      expect(mockRegisterForEvent).not.toHaveBeenCalled();
      expect(result.current.state.selectedEventForRegistration?.id).toBe(
        "evt-1",
      );
    });
  });
});
