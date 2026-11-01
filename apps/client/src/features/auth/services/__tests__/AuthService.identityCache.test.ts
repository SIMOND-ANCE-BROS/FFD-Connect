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
import { useClubStore } from "../../../../stores/club.store";
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

async function stopSupportAccess(): Promise<void> {
  await AsyncStorage.setItem(
    "impersonation_backup",
    JSON.stringify({ isLoggedIn: true, role: "ADMIN", username: "admin@x.fr" }),
  );
  post.mockResolvedValueOnce({ data: {} });
  await AuthService.stopImpersonation();
}

/** Observers of the shared query client, dropped even when a test fails. */
const subscriptions: (() => void)[] = [];

afterEach(() => {
  subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
});

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

    await stopSupportAccess();

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
    subscriptions.push(observer.subscribe(() => undefined));
    let late: (value: unknown) => void = () => undefined;
    getPreferences.mockReturnValueOnce(
      new Promise((resolve) => {
        late = resolve;
      }),
    );
    const loading = useNotificationPreferencesStore.getState().load();
    expect(observer.getCurrentResult().fetchStatus).toBe("fetching");

    await startSupportAccess();
    answer("admin-registration");
    late([{ type: "t", label: "admin", description: "", enabled: true }]);
    await loading;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observer.getCurrentResult().data).toBeUndefined();
    expectNothingOf("admin", queryClient);
    expect(useNotificationPreferencesStore.getState().preferences).toEqual([]);
  });

  // The keychain switches are mocked here, so the HTTP-level identity guard
  // (#901, covered in api.sessionGeneration.test.ts) does not move: these
  // prove the cache cancel/clear and the stores' own session counters.
  it("an answer still in flight for the licensee never lands once the access ends", async () => {
    await startSupportAccess();
    let answer: (data: string) => void = () => undefined;
    const observer = new QueryObserver<string>(queryClient, {
      queryKey: REGISTRATIONS,
      queryFn: () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    });
    subscriptions.push(observer.subscribe(() => undefined));
    let late: (value: unknown) => void = () => undefined;
    getPreferences.mockReturnValueOnce(
      new Promise((resolve) => {
        late = resolve;
      }),
    );
    const loading = useNotificationPreferencesStore.getState().load();
    expect(observer.getCurrentResult().fetchStatus).toBe("fetching");

    await stopSupportAccess();
    answer("target-registration");
    late([{ type: "t", label: "target", description: "", enabled: true }]);
    await loading;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observer.getCurrentResult().data).toBeUndefined();
    expectNothingOf("target", queryClient);
    expect(useNotificationPreferencesStore.getState().preferences).toEqual([]);
  });

  it("a full round trip admin → licensee → admin leaves nothing of the licensee behind", async () => {
    await useAppAs("admin");
    await startSupportAccess();
    expectNothingOf("admin", await restartedCache());

    await useAppAs("target");
    await stopSupportAccess();

    // Back on the admin account: none of the licensee's data, in memory or
    // after a restart.
    for (const client of [queryClient, await restartedCache()]) {
      expectNothingOf("target", client);
    }
    expect(await persistedCopy()).toBeNull();
    expect(useNotificationPreferencesStore.getState().preferences).toEqual([]);
  });
});

describe("the target's session holds none of the admin's own profile (#879)", () => {
  const ADMIN_CONFIG = {
    isLoggedIn: true,
    role: "ADMIN",
    username: "admin@x.fr",
    userId: "admin-id",
    licensePhotoUri: "file:///admin-photo.jpg",
    hasWdsfLicense: true,
    ageGroup: "ADMIN-AGE",
    category: "ADMIN-CAT",
    level: "ADMIN-LEVEL",
    passportLevelLatin: "ADMIN-LATIN",
    passportLevelStandard: "ADMIN-STD",
    registrationPolicy: "ADMIN-POLICY",
    clubName: "Admin club",
    clubLogoUri: "file:///admin-club.png",
    clubDashboardConfig: '{"admin":true}',
    lastUser: "admin@x.fr",
    lastSpace: "ADMIN",
    isStoreReview: true,
    appTheme: "dark",
  };

  async function impersonateFrom(config: object): Promise<void> {
    await AsyncStorage.setItem("auth_config", JSON.stringify(config));
    post.mockResolvedValueOnce({
      data: {
        access_token: "target-token",
        user: { role: "LICENSEE", email: "target@x.fr" },
      },
    });
    await AuthService.impersonate("target-1", "Target");
  }

  it("start: no admin profile field in the target's config, preferences kept", async () => {
    await impersonateFrom(ADMIN_CONFIG);

    const config = await AuthService.getAuthConfig();
    expect(config).toMatchObject({
      impersonating: true,
      username: "target@x.fr",
      role: "LICENSEE",
      appTheme: "dark",
    });
    // Back to the default, not the admin's WDSF licence.
    expect(config.hasWdsfLicense).not.toBe(true);
    expect(JSON.stringify(config)).not.toMatch(/admin/i);
  });

  it("end: the admin's own profile comes back from the backup", async () => {
    await impersonateFrom(ADMIN_CONFIG);
    post.mockResolvedValueOnce({ data: {} });

    await AuthService.stopImpersonation();

    const config = await AuthService.getAuthConfig();
    expect(config).toMatchObject({
      username: "admin@x.fr",
      userId: "admin-id",
      licensePhotoUri: "file:///admin-photo.jpg",
      clubLogoUri: "file:///admin-club.png",
      hasWdsfLicense: true,
    });
    expect(config.impersonating).toBeUndefined();
  });

  it("end without a readable backup: none of the target's data stays", async () => {
    await impersonateFrom(ADMIN_CONFIG);
    await AuthService.saveAuthConfig({
      ...(await AuthService.getAuthConfig()),
      userId: "target-id",
      licensePhotoUri: "file:///target-photo.jpg",
      category: "TARGET-CAT",
      clubLogoUri: "file:///target-club.png",
    });
    await AsyncStorage.removeItem("impersonation_backup");
    post.mockResolvedValueOnce({ data: {} });

    await AuthService.stopImpersonation();

    const config = await AuthService.getAuthConfig();
    expect(config.isLoggedIn).toBe(false);
    expect(config.impersonating).toBeUndefined();
    expect(JSON.stringify(config)).not.toMatch(/target/i);
  });

  it("the club logo shown in the tab bar leaves with the previous account", async () => {
    useClubStore.getState().setClubLogoUri("file:///admin-club.png");

    await impersonateFrom(ADMIN_CONFIG);

    expect(useClubStore.getState().clubLogoUri).toBeNull();
  });
});

describe("login starts from an empty cache (#892)", () => {
  const acceptLoginOf = (email: string) =>
    post.mockResolvedValueOnce({
      data: {
        access_token: `${email}-access`,
        refresh_token: `${email}-refresh`,
        user: { id: email, role: "LICENSEE", email },
      },
    });

  it("nothing a previous account left behind, in memory or after a restart", async () => {
    // Data of a previous account still there (a write that slipped past a
    // session end, an older build…).
    await useAppAs("previous");
    expect(await persistedCopy()).toContain("previous-registration");
    acceptLoginOf("b@x.fr");

    await AuthService.login("b@x.fr", "pw");

    expectNothingOf("previous", queryClient);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(await persistedCopy()).toBeNull();
    expectNothingOf("previous", await restartedCache());
    expect(useNotificationPreferencesStore.getState().preferences).toEqual([]);
  });

  it("a rejected login leaves the current cache alone", async () => {
    await useAppAs("current");
    post.mockRejectedValueOnce(new Error("401"));

    await expect(AuthService.login("b@x.fr", "bad")).rejects.toThrow();

    expect(JSON.stringify(queryClient.getQueryData(REGISTRATIONS))).toContain(
      "current-registration",
    );
  });

  it("register starts from an empty cache too", async () => {
    await useAppAs("previous");
    acceptLoginOf("new@x.fr");

    await AuthService.register("new@x.fr", "pw", "123", "Doe", "Jane");

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(await persistedCopy()).toBeNull();
  });
});
