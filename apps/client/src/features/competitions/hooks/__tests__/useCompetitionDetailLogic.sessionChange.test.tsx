/**
 * #892 — an optimistic registration still in flight when the session ends
 * (refresh token rejected, logout, support access) must not write account A's
 * registrations back into the emptied cache, nor into its persisted copy, for
 * the next account to find. Runs the REAL query client, session-end registry
 * and token store (identity generation); only the network is mocked.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from "@tanstack/react-query-persist-client";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";

import { clearTokens, setTokens } from "../../../../api/tokenStore";
import { useAuthRepository } from "../../../../features/auth/context/AuthContext";
import { useClubRepository } from "../../../../features/club/context/ClubContext";
import { createPartialEvent } from "../../../../hooks/__mocks__/types";
import {
  QUERY_CACHE_KEY,
  queryClient,
  shouldPersistQuery,
} from "../../../../services/queryClient";
import { runSessionEndCleanups } from "../../../../services/sessionCleanup";
import { useOfflineQueueStore } from "../../../../stores/offlineQueue.store";
import { useCompetitionRepository } from "../../context/CompetitionContext";
import { useCompetitionDetailLogic } from "../useCompetitionDetailLogic";

jest.mock("../../../../features/auth/context/AuthContext", () => ({
  useAuthRepository: jest.fn(),
  UserRole: { LICENSEE: "LICENSEE", CLUB: "CLUB", GUEST: "GUEST" },
}));
jest.mock("../../../../navigation/authReturn", () => ({
  useSignInAndReturn: () => jest.fn(),
}));
jest.mock("../../context/CompetitionContext", () => ({
  useCompetitionRepository: jest.fn(),
}));
jest.mock("../../../../features/club/context/ClubContext", () => ({
  useClubRepository: jest.fn(),
}));
jest.mock("../../../../features/club/services/ClubService", () => ({
  ClubService: {
    getHelloAssoStatus: jest.fn(async () => ({ registrationMode: "X" })),
    getMyClubRegistrationMode: jest.fn(async () => ({
      registrationMode: "X",
    })),
  },
}));
jest.mock("../../../../services/analytics", () => ({
  analytics: { logEvent: jest.fn() },
}));

jest.spyOn(Alert, "alert");

const COMPETITION = "comp-1";
const A_REGISTRATIONS = [
  { eventId: "evt-A", partnerName: "Partner of A", status: "CONFIRMED" },
];

const registerForEvent = jest.fn();
const unregisterFromEvent = jest.fn();
const getUserRegistrations = jest.fn();
const stableAuth = {
  getAuthConfig: jest.fn(async () => ({
    role: "LICENSEE",
    category: "A",
    ageGroup: "Adulte",
  })),
};

const persister = () =>
  createAsyncStoragePersister({
    storage: AsyncStorage,
    key: QUERY_CACHE_KEY,
    throttleTime: 0,
  });

/** What the persister would write now, read back as at a cold start. */
async function persistedNow(): Promise<QueryClient> {
  await persistQueryClientSave({
    queryClient,
    persister: persister(),
    dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
  });
  const restarted = new QueryClient();
  await persistQueryClientRestore({
    queryClient: restarted,
    persister: persister(),
  });
  return restarted;
}

function nothingOfA(client: QueryClient): void {
  expect(
    JSON.stringify(client.getQueryData(["myRegistrations"]) ?? null),
  ).not.toMatch(/evt-A|Partner of A|evt-1/);
}

/** A deferred server answer. */
function deferred() {
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<never>((_resolve, rej) => {
    reject = rej;
  });
  return { promise, reject };
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

async function mountAsA() {
  const hook = await renderHook(
    () =>
      useCompetitionDetailLogic(COMPETITION, { goBack: jest.fn() } as never),
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.state.loading).toBe(false));
  await waitFor(() =>
    expect(queryClient.getQueryData(["myRegistrations"])).toEqual(
      A_REGISTRATIONS,
    ),
  );
  return hook;
}

/** The session ends as when the refresh token is rejected (#879). */
async function sessionEnds(): Promise<void> {
  await clearTokens();
  await runSessionEndCleanups();
}

beforeEach(async () => {
  jest.clearAllMocks();
  queryClient.clear();
  await AsyncStorage.clear();
  useOfflineQueueStore.getState().setItems([]);
  (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
  await setTokens({ authToken: "token-A", refreshToken: "refresh-A" });
  (useAuthRepository as jest.Mock).mockReturnValue(stableAuth);
  (useClubRepository as jest.Mock).mockReturnValue({
    getMembers: jest.fn(async () => []),
    checkEligibility: jest.fn(),
  });
  (useCompetitionRepository as jest.Mock).mockReturnValue({
    getCompetitionDetails: jest.fn(async () => ({
      id: COMPETITION,
      events: [{ id: "evt-1", name: "Event 1", category: "A" }],
    })),
    getCompetitionDetailsForUser: jest.fn(async () => ({
      id: COMPETITION,
      events: [{ id: "evt-1", name: "Event 1", category: "A" }],
    })),
    registerForEvent,
    unregisterFromEvent,
    getUserRegistrations,
    getClubPendingRegistrations: jest.fn(async () => []),
    registerMember: jest.fn(),
    confirmRegistration: jest.fn(),
    unregisterMember: jest.fn(),
  });
  getUserRegistrations.mockResolvedValue(A_REGISTRATIONS);
});

afterAll(() => {
  jest.useFakeTimers();
  jest.clearAllTimers();
});

describe("optimistic registrations across a session end (#892)", () => {
  it("register: a failure landing after the session ended writes nothing back", async () => {
    const answer = deferred();
    registerForEvent.mockReturnValueOnce(answer.promise);
    const { result, unmount } = await mountAsA();

    await act(async () => {
      void result.current.actions.handleRegister(
        createPartialEvent({ id: "evt-1", eventType: "SOLO" } as never),
      );
    });
    await waitFor(() => expect(registerForEvent).toHaveBeenCalled());

    await sessionEnds();
    // The navigator re-mounts on an identity change: the screen is gone, its
    // mutation is not.
    await unmount();
    await act(async () => {
      answer.reject(new Error("500"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    nothingOfA(queryClient);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    nothingOfA(await persistedNow());
    // Nothing shown to whoever uses the app now.
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("unregister: a failure landing after the session ended writes nothing back", async () => {
    const answer = deferred();
    unregisterFromEvent.mockReturnValueOnce(answer.promise);
    const { result, unmount } = await mountAsA();

    await act(async () => {
      result.current.actions.handleUnregister(
        createPartialEvent({ id: "evt-A", eventType: "SOLO" } as never),
      );
    });
    await waitFor(() => expect(unregisterFromEvent).toHaveBeenCalled());

    await sessionEnds();
    await unmount();
    await act(async () => {
      answer.reject(new Error("500"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    nothingOfA(queryClient);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    nothingOfA(await persistedNow());
  });

  it("same session: the failure still rolls back and is reported (control)", async () => {
    const answer = deferred();
    registerForEvent.mockReturnValueOnce(answer.promise);
    const { result } = await mountAsA();

    await act(async () => {
      void result.current.actions.handleRegister(
        createPartialEvent({ id: "evt-1", eventType: "SOLO" } as never),
      );
    });
    await waitFor(() =>
      expect(queryClient.getQueryData(["myRegistrations"])).toHaveLength(2),
    );
    await act(async () => {
      answer.reject(new Error("500"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(["myRegistrations"])).toEqual(
        A_REGISTRATIONS,
      ),
    );
    expect(Alert.alert).toHaveBeenCalledWith(
      "Erreur",
      expect.any(String) as unknown,
    );
  });
});
