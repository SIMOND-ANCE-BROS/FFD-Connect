/**
 * #879 — a support access (« se connecter en tant que ») changes the identity
 * the app speaks for. Nothing of the previous account may show up afterwards:
 * not in the React Query cache, not in its persisted copy (app restart), not
 * in the per-account stores. Runs the REAL session-end registry, query client
 * and stores; only the network and the keychain switches are mocked.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from "@tanstack/react-query-persist-client";

import api from "../../../../services/api";
import { NotificationApi } from "../../../../services/api/notification-api";
import {
  QUERY_CACHE_KEY,
  queryClient,
  shouldPersistQuery,
} from "../../../../services/queryClient";
import { useNotificationPreferencesStore } from "../../../../stores/notificationPreferences.store";
import { AuthService } from "../AuthService";

jest.mock("../../../../services/api", () => ({
  post: jest.fn(),
  get: jest.fn(),
}));
jest.mock("../../../../services/api/notification-api", () => ({
  NotificationApi: { getPreferences: jest.fn(), updatePreference: jest.fn() },
}));
jest.mock("../../../../api/tokenStore", () => ({
  ...jest.requireActual<object>("../../../../api/tokenStore"),
  switchToImpersonation: jest.fn(async () => undefined),
  restoreFromImpersonation: jest.fn(async () => true),
  clearTokens: jest.fn(async () => undefined),
  clearImpersonationBackupTokens: jest.fn(async () => undefined),
}));
jest.mock("../../../../api/sessionRefresh", () => ({
  waitForPendingRefresh: jest.fn(async () => undefined),
}));
jest.mock("../../../settings/services/pushRegistration", () => ({
  registerDeviceTokenForPush: jest.fn(),
  unregisterDeviceTokenForPush: jest.fn(),
}));

const post = api.post as jest.Mock;
const getPreferences = NotificationApi.getPreferences as jest.Mock;

const REGISTRATIONS = ["competitions", "user", "registrations"] as const;
const PARTNER = ["career", "me", "partnerships", "current"] as const;

const persister = () =>
  createAsyncStoragePersister({
    storage: AsyncStorage,
    key: QUERY_CACHE_KEY,
    throttleTime: 0,
  });

/** What the app finds in its cache at the next cold start. */
async function restartedCache(): Promise<QueryClient> {
  const fresh = new QueryClient();
  await persistQueryClientRestore({
    queryClient: fresh,
    persister: persister(),
  });
  return fresh;
}

/** Account `owner` has been using the app: its data cached and persisted. */
async function useAppAs(owner: string): Promise<void> {
  queryClient.setQueryData(REGISTRATIONS, [{ id: `${owner}-registration` }]);
  queryClient.setQueryData(PARTNER, { name: `${owner}'s partner` });
  await persistQueryClientSave({
    queryClient,
    persister: persister(),
    dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
  });
  getPreferences.mockResolvedValueOnce([
    { type: "results_published", label: owner, description: "", enabled: true },
  ]);
  await useNotificationPreferencesStore.getState().load();
}

const persistedCopy = () => AsyncStorage.getItem(QUERY_CACHE_KEY);

function expectNothingOf(owner: string, client: QueryClient) {
  expect(
    JSON.stringify(client.getQueryData(REGISTRATIONS) ?? null),
  ).not.toContain(owner);
  expect(JSON.stringify(client.getQueryData(PARTNER) ?? null)).not.toContain(
    owner,
  );
}

async function startSupportAccess(): Promise<void> {
  await AsyncStorage.setItem(
    "auth_config",
    JSON.stringify({ isLoggedIn: true, role: "ADMIN", username: "admin@x.fr" }),
  );
  post.mockResolvedValueOnce({
    data: {
      access_token: "target-token",
      user: { role: "LICENSEE", email: "target@x.fr" },
    },
  });
  await AuthService.impersonate("target-1", "Target");
}

beforeEach(async () => {
  jest.clearAllMocks();
  queryClient.clear();
  useNotificationPreferencesStore.getState().reset();
  await AsyncStorage.clear();
});

describe("identity change clears the previous account's data (#879)", () => {
  it("start of a support access: nothing of the admin, in memory or after a restart", async () => {
    await useAppAs("admin");
    expect(await persistedCopy()).toContain("admin-registration");

    await startSupportAccess();

    expectNothingOf("admin", queryClient);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(await persistedCopy()).toBeNull();
    expectNothingOf("admin", await restartedCache());
    expect(useNotificationPreferencesStore.getState().preferences).toEqual([]);
  });

  it("end of a support access: nothing of the licensee, in memory or after a restart", async () => {
    await startSupportAccess();
    await useAppAs("target");
    expect(await persistedCopy()).toContain("target-registration");
    await AsyncStorage.setItem(
      "impersonation_backup",
      JSON.stringify({
        isLoggedIn: true,
        role: "ADMIN",
        username: "admin@x.fr",
      }),
    );
    post.mockResolvedValueOnce({ data: {} });

    await AuthService.stopImpersonation();

    expectNothingOf("target", queryClient);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(await persistedCopy()).toBeNull();
    expectNothingOf("target", await restartedCache());
    expect(useNotificationPreferencesStore.getState().preferences).toEqual([]);
  });

  it("an answer still in flight for the previous account never lands", async () => {
    let answer: (data: string) => void = () => undefined;
    const observer = new QueryObserver<string>(queryClient, {
      queryKey: REGISTRATIONS,
      queryFn: () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    });
    const unsubscribe = observer.subscribe(() => undefined);
    let late: (value: unknown) => void = () => undefined;
    getPreferences.mockReturnValueOnce(
      new Promise((resolve) => {
        late = resolve;
      }),
    );
    const loading = useNotificationPreferencesStore.getState().load();

    await startSupportAccess();
    answer("admin-registration");
    late([{ type: "t", label: "admin", description: "", enabled: true }]);
    await loading;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observer.getCurrentResult().data).toBeUndefined();
    expectNothingOf("admin", queryClient);
    expect(useNotificationPreferencesStore.getState().preferences).toEqual([]);
    unsubscribe();
  });
});
