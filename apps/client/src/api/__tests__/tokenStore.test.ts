import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import {
  ImpersonationBackupError,
  clearImpersonationBackupTokens,
  clearTokens,
  getAccessToken,
  getTokens,
  restoreFromImpersonation,
  setImpersonationBackupTokens,
  setTokens,
  setTokensIfRefreshIs,
  clearTokensIfRefreshIs,
  IMPERSONATION_BACKUP_KEY,
  switchToImpersonation,
} from "../tokenStore";
import {
  TokenStoreUnavailableError,
  isTokenStoreUnavailable,
} from "../tokenStoreErrors";

jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

const asyncRemove = AsyncStorage.removeItem as jest.Mock;
const getItemAsync = SecureStore.getItemAsync as jest.Mock;
const setItemAsync = SecureStore.setItemAsync as jest.Mock;
const deleteItemAsync = SecureStore.deleteItemAsync as jest.Mock;
const asyncGet = AsyncStorage.getItem as jest.Mock;
const asyncSet = AsyncStorage.setItem as jest.Mock;

const OPTS = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
const LOCKED = new Error(
  "Calling the 'getValueWithKeyAsync' function has failed\n→ Caused by: KeyChainException: User interaction is not allowed.",
);

/** Fake keychain backed by a plain object; the mocks record every call. */
function keychain(initial: Record<string, string>): Record<string, string> {
  const store = { ...initial };
  getItemAsync.mockImplementation((k: string) =>
    Promise.resolve(store[k] ?? null),
  );
  setItemAsync.mockImplementation((k: string, v: string) => {
    store[k] = v;
    return Promise.resolve();
  });
  deleteItemAsync.mockImplementation((k: string) => {
    delete store[k];
    return Promise.resolve();
  });
  return store;
}

beforeEach(() => {
  jest.clearAllMocks();
  getItemAsync.mockResolvedValue(null);
  setItemAsync.mockResolvedValue(undefined);
  deleteItemAsync.mockResolvedValue(undefined);
  asyncGet.mockResolvedValue(null);
  asyncSet.mockResolvedValue(undefined);
});

describe("tokenStore", () => {
  it("reads both tokens from the AFTER_FIRST_UNLOCK keys", async () => {
    keychain({ "ffd.session.access": "a", "ffd.session.refresh": "r" });
    await expect(getTokens()).resolves.toEqual({
      authToken: "a",
      refreshToken: "r",
    });
    expect(getItemAsync).toHaveBeenCalledWith("ffd.session.access", OPTS);
  });

  it("getAccessToken returns the access token", async () => {
    keychain({ "ffd.session.access": "a" });
    await expect(getAccessToken()).resolves.toBe("a");
  });

  it("setTokens writes only provided values, readable after first unlock (#582)", async () => {
    await setTokens({ authToken: "a" });
    expect(setItemAsync).toHaveBeenCalledWith("ffd.session.access", "a", OPTS);
    expect(setItemAsync).toHaveBeenCalledTimes(1);
    // Only the superseded pre-#582 access key goes — never the refresh token.
    expect(deleteItemAsync).toHaveBeenCalledTimes(1);
    expect(deleteItemAsync).toHaveBeenCalledWith("ffd.authToken", OPTS);
  });

  it("clearTokens deletes the new and the pre-#582 keys", async () => {
    await clearTokens();
    for (const k of [
      "ffd.session.access",
      "ffd.session.refresh",
      "ffd.authToken",
      "ffd.refreshToken",
    ]) {
      expect(deleteItemAsync).toHaveBeenCalledWith(k, OPTS);
    }
  });

  it("clearTokens also drops the offline queue (#416)", async () => {
    // Every session end funnels through here — logout, an expired refresh
    // token, an impersonation switch. A surviving entry would be replayed
    // with the NEXT account's token.
    await clearTokens();
    expect(asyncRemove).toHaveBeenCalledWith("@ffd/offline-queue");
  });

  describe("migration of WHEN_UNLOCKED items (#582)", () => {
    it("moves pre-#582 tokens to the new keys, then deletes the old ones", async () => {
      const store = keychain({
        "ffd.authToken": "oa",
        "ffd.refreshToken": "or",
      });

      await expect(getTokens()).resolves.toEqual({
        authToken: "oa",
        refreshToken: "or",
      });

      // New items are ADDED under new keys: rewriting the old keys would only
      // update their data and keep WHEN_UNLOCKED on iOS (SecItemUpdate).
      expect(setItemAsync).toHaveBeenCalledWith(
        "ffd.session.access",
        "oa",
        OPTS,
      );
      expect(setItemAsync).toHaveBeenCalledWith(
        "ffd.session.refresh",
        "or",
        OPTS,
      );
      expect(store).toEqual({
        "ffd.session.access": "oa",
        "ffd.session.refresh": "or",
      });
    });

    it("migrates only once", async () => {
      keychain({ "ffd.authToken": "oa", "ffd.refreshToken": "or" });
      await getTokens();
      setItemAsync.mockClear();
      await getTokens();
      expect(setItemAsync).not.toHaveBeenCalled();
    });

    it("writes the new key before deleting the old one (no window without a token)", async () => {
      keychain({ "ffd.authToken": "oa" });
      const order: string[] = [];
      setItemAsync.mockImplementation((k: string) => {
        order.push(`set ${k}`);
        return Promise.resolve();
      });
      deleteItemAsync.mockImplementation((k: string) => {
        order.push(`delete ${k}`);
        return Promise.resolve();
      });
      await getTokens();
      expect(order).toEqual(["set ffd.session.access", "delete ffd.authToken"]);
    });

    it("still returns the token when the move itself fails", async () => {
      keychain({ "ffd.authToken": "oa" });
      setItemAsync.mockRejectedValue(new Error("keychain write failed"));
      await expect(getAccessToken()).resolves.toBe("oa");
    });

    it("never migrates a stale token over one written by a concurrent refresh", async () => {
      const store = keychain({ "ffd.refreshToken": "stale" });
      // Both start together: the read sees no new key, the refresh writes
      // before the migration gets the lock.
      await Promise.all([
        getTokens(),
        setTokens({ authToken: "fa", refreshToken: "fresh" }),
      ]);
      expect(store["ffd.session.refresh"]).toBe("fresh");
      expect(store["ffd.refreshToken"]).toBeUndefined();
    });
  });

  describe("unreadable store (locked iPhone, #582)", () => {
    it("throws a typed error flagged as locked — never an empty session", async () => {
      getItemAsync.mockRejectedValue(LOCKED);
      const error: unknown = await getTokens().catch((e: unknown) => e);
      expect(isTokenStoreUnavailable(error)).toBe(true);
      expect((error as TokenStoreUnavailableError).locked).toBe(true);
    });

    it("does not touch the store nor the legacy blob on a failed read", async () => {
      getItemAsync.mockRejectedValue(LOCKED);
      await expect(getAccessToken()).rejects.toBeInstanceOf(
        TokenStoreUnavailableError,
      );
      expect(setItemAsync).not.toHaveBeenCalled();
      expect(deleteItemAsync).not.toHaveBeenCalled();
      expect(asyncGet).not.toHaveBeenCalled();
    });

    it("wraps any other read failure too, with locked=false", async () => {
      getItemAsync.mockRejectedValue(new Error("boom"));
      const error: unknown = await getTokens().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TokenStoreUnavailableError);
      expect((error as TokenStoreUnavailableError).locked).toBe(false);
    });

    it("reads migrated tokens without touching the old keys (works while locked)", async () => {
      getItemAsync.mockImplementation((k: string) =>
        k.startsWith("ffd.session.")
          ? Promise.resolve(`${k}-v`)
          : Promise.reject(LOCKED),
      );
      await expect(getTokens()).resolves.toEqual({
        authToken: "ffd.session.access-v",
        refreshToken: "ffd.session.refresh-v",
      });
    });
  });

  it("serves the access token when only the not-yet-migrated refresh token is locked", async () => {
    getItemAsync.mockImplementation((k: string) => {
      if (k === "ffd.session.access") return Promise.resolve("a");
      if (k === "ffd.refreshToken") return Promise.reject(LOCKED);
      return Promise.resolve(null);
    });
    await expect(getTokens()).resolves.toEqual({ authToken: "a" });
  });

  it("still fails when the access token itself is locked", async () => {
    getItemAsync.mockImplementation((k: string) =>
      k === "ffd.session.refresh"
        ? Promise.resolve("r")
        : Promise.reject(LOCKED),
    );
    await expect(getTokens()).rejects.toBeInstanceOf(
      TokenStoreUnavailableError,
    );
  });

  describe("permanently unreadable store (not a lock)", () => {
    const BROKEN = new Error("Keystore: bad decrypt");

    // Fresh module per test: the report/latch flags are per app session.
    function load(appState: string) {
      jest.resetModules();
      const RN = require("react-native") as {
        AppState: { currentState: string };
      };
      Object.defineProperty(RN.AppState, "currentState", {
        configurable: true,
        get: () => appState,
      });
      const store = require("../tokenStore") as typeof import("../tokenStore");
      const secure = require("expo-secure-store") as Record<string, jest.Mock>;
      const sentry = require("@sentry/react-native") as Record<
        string,
        jest.Mock
      >;
      secure.setItemAsync.mockResolvedValue(undefined);
      secure.deleteItemAsync.mockResolvedValue(undefined);
      const handler = jest.fn(() => Promise.resolve());
      store.setUnreadableSessionHandler(handler);
      return { store, secure, sentry, handler };
    }

    /** Runs a read through its retry delay; resolves to value or error. */
    async function settle(p: Promise<unknown>): Promise<unknown> {
      const caught = p.catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(600);
      return caught;
    }
    const later = (ms: number) => jest.advanceTimersByTimeAsync(ms);

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("waits ~500 ms before the single retry, then recovers silently", async () => {
      const { store, secure, sentry, handler } = load("active");
      secure.getItemAsync
        .mockRejectedValueOnce(new Error("transient"))
        .mockResolvedValue("a");

      const p = store.getAccessToken();
      await jest.advanceTimersByTimeAsync(0);
      const callsBefore = secure.getItemAsync.mock.calls.length;
      await jest.advanceTimersByTimeAsync(400);
      // No retry yet at 400 ms.
      expect(secure.getItemAsync.mock.calls.length).toBe(callsBefore);
      await expect(settle(p)).resolves.toBe("a");

      expect(sentry.captureException).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });

    it("a first permanent failure is reported but never ends the session", async () => {
      const { store, secure, sentry, handler } = load("active");
      secure.getItemAsync.mockRejectedValue(BROKEN);

      // Access + refresh reads of one getTokens = one burst.
      expect(await settle(store.getTokens())).toBeInstanceOf(Error);
      await later(1_000);
      expect(await settle(store.getTokens())).toBeInstanceOf(Error);

      expect(sentry.captureException).toHaveBeenCalledTimes(1);
      expect(secure.deleteItemAsync).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });

    it("ends the session on a second, independent failure >= 5 s later (foreground)", async () => {
      const { store, secure, sentry, handler } = load("active");
      secure.getItemAsync.mockRejectedValue(BROKEN);

      await settle(store.getTokens());
      await later(6_000);
      await settle(store.getTokens());
      await later(0);

      expect(sentry.captureException).toHaveBeenCalledTimes(1);
      expect(secure.deleteItemAsync).toHaveBeenCalledWith(
        "ffd.session.access",
        expect.anything(),
      );
      expect(secure.deleteItemAsync).toHaveBeenCalledWith(
        "ffd.session.refresh",
        expect.anything(),
      );
      expect(handler).toHaveBeenCalledTimes(1);

      // Latch never reset: a third failure does not log out again.
      await later(6_000);
      await settle(store.getTokens());
      await later(0);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("a successful read in between clears the suspicion", async () => {
      const { store, secure, handler } = load("active");
      secure.getItemAsync.mockRejectedValue(BROKEN);
      await settle(store.getTokens());

      secure.getItemAsync.mockResolvedValue("a");
      await settle(store.getTokens());

      secure.getItemAsync.mockRejectedValue(BROKEN);
      await later(6_000);
      await settle(store.getTokens());
      await later(0);

      expect(secure.deleteItemAsync).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });

    it("a login after the first failure: the next failure does not confirm it", async () => {
      const { store, secure, handler } = load("active");
      secure.getItemAsync.mockRejectedValue(BROKEN);
      await settle(store.getTokens());

      await store.setTokens({ authToken: "fresh" });
      secure.deleteItemAsync.mockClear();

      await later(6_000);
      await settle(store.getTokens());
      await later(0);

      expect(secure.deleteItemAsync).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });

    it("a login racing the session end wins: tokens kept, handler skipped", async () => {
      const { store, secure, handler } = load("active");
      secure.getItemAsync.mockRejectedValue(BROKEN);
      await settle(store.getTokens());
      await later(6_000);

      // The confirming failure queues the session end behind the lock; a
      // login already holding the lock lands first.
      let release: () => void = () => undefined;
      secure.setItemAsync.mockImplementationOnce(
        () => new Promise<void>((r) => (release = r)),
      );
      const login = store.setTokens({ authToken: "fresh" });
      await settle(store.getTokens());
      release();
      await login;
      await later(0);

      expect(secure.deleteItemAsync).not.toHaveBeenCalledWith(
        "ffd.session.access",
        expect.anything(),
      );
      expect(handler).not.toHaveBeenCalled();
    });

    it("in the background: reports but keeps the session", async () => {
      const { store, secure, sentry, handler } = load("background");
      secure.getItemAsync.mockRejectedValue(BROKEN);

      await settle(store.getTokens());
      await later(6_000);
      await settle(store.getTokens());
      await later(0);

      expect(sentry.captureException).toHaveBeenCalledTimes(1);
      expect(secure.deleteItemAsync).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });

    it("a locked device is never retried, reported nor logged out", async () => {
      const { store, secure, sentry, handler } = load("active");
      secure.getItemAsync.mockRejectedValue(LOCKED);

      await settle(store.getTokens());
      await later(6_000);
      await settle(store.getTokens());
      await later(0);

      expect(secure.getItemAsync).toHaveBeenCalledTimes(4); // 2 per read, no retry
      expect(sentry.captureException).not.toHaveBeenCalled();
      expect(secure.deleteItemAsync).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  it("migrates legacy tokens from AsyncStorage when SecureStore is empty", async () => {
    asyncGet.mockResolvedValue(
      JSON.stringify({ authToken: "la", refreshToken: "lr", role: "LICENSEE" }),
    );

    const tokens = await getTokens();

    expect(tokens).toEqual({ authToken: "la", refreshToken: "lr" });
    expect(setItemAsync).toHaveBeenCalledWith("ffd.session.access", "la", OPTS);
    expect(setItemAsync).toHaveBeenCalledWith(
      "ffd.session.refresh",
      "lr",
      OPTS,
    );
    // Legacy blob rewritten without the secrets, preferences preserved.
    const rewritten = JSON.parse(asyncSet.mock.calls[0][1] as string);
    expect(rewritten.authToken).toBeUndefined();
    expect(rewritten.refreshToken).toBeUndefined();
    expect(rewritten.role).toBe("LICENSEE");
  });

  it("returns empty when neither store has tokens", async () => {
    await expect(getTokens()).resolves.toEqual({});
  });
});

describe("impersonation backup (#591)", () => {
  it("stores the admin's tokens under dedicated keys, same keychain class", async () => {
    const store = keychain({ "ffd.session.access": "live" });

    await setImpersonationBackupTokens({ authToken: "a", refreshToken: "r" });

    expect(setItemAsync).toHaveBeenCalledWith(
      "ffd.impersonation.access",
      "a",
      OPTS,
    );
    expect(setItemAsync).toHaveBeenCalledWith(
      "ffd.impersonation.refresh",
      "r",
      OPTS,
    );
    // The live session is not touched.
    expect(store["ffd.session.access"]).toBe("live");
  });

  it("is a full snapshot: a missing token deletes an older one", async () => {
    const store = keychain({
      "ffd.impersonation.access": "old-a",
      "ffd.impersonation.refresh": "old-r",
    });

    await setImpersonationBackupTokens({ authToken: "a" });

    expect(store).toEqual({ "ffd.impersonation.access": "a" });
  });

  it("clearImpersonationBackupTokens drops both keys, never the session", async () => {
    const store = keychain({
      "ffd.session.refresh": "live",
      "ffd.impersonation.access": "a",
      "ffd.impersonation.refresh": "r",
    });

    await clearImpersonationBackupTokens();

    expect(store).toEqual({ "ffd.session.refresh": "live" });
  });

  it("clearTokens keeps the backup", async () => {
    const store = keychain({
      "ffd.session.access": "admin",
      "ffd.impersonation.access": "a",
    });

    await clearTokens();

    expect(store).toEqual({ "ffd.impersonation.access": "a" });
  });
});

describe("switchToImpersonation (atomic, #598 review)", () => {
  it("backs the admin's session up, wipes it with the offline queue, writes the target token", async () => {
    const store = keychain({
      "ffd.session.access": "admin-a",
      "ffd.session.refresh": "admin-r",
    });

    await switchToImpersonation("imp");

    expect(store).toEqual({
      "ffd.impersonation.access": "admin-a",
      "ffd.impersonation.refresh": "admin-r",
      "ffd.session.access": "imp",
    });
    expect(asyncRemove).toHaveBeenCalledWith("@ffd/offline-queue");
  });

  it("backs up a not-yet-migrated (pre-#582) admin session too", async () => {
    const store = keychain({
      "ffd.authToken": "admin-a",
      "ffd.refreshToken": "admin-r",
    });

    await switchToImpersonation("imp");

    expect(store).toEqual({
      "ffd.impersonation.access": "admin-a",
      "ffd.impersonation.refresh": "admin-r",
      "ffd.session.access": "imp",
    });
  });

  it.each([
    [{ "ffd.session.access": "admin-a" }],
    [{ "ffd.session.refresh": "admin-r" }],
    [{}],
  ])(
    "requires both admin tokens, changing nothing otherwise (%j)",
    async (initial: Record<string, string>) => {
      const store = keychain(initial);

      const error: unknown = await switchToImpersonation("imp").catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(ImpersonationBackupError);
      expect(store).toEqual(initial);
    },
  );

  it("an unreadable session aborts before any write", async () => {
    keychain({ "ffd.session.access": "admin-a" });
    getItemAsync.mockRejectedValue(LOCKED);

    await expect(switchToImpersonation("imp")).rejects.toThrow(
      TokenStoreUnavailableError,
    );
    expect(setItemAsync).not.toHaveBeenCalled();
    expect(deleteItemAsync).not.toHaveBeenCalled();
  });

  it("a token write queued during the switch lands after it, never in between", async () => {
    const store = keychain({
      "ffd.session.access": "admin-a",
      "ffd.session.refresh": "admin-r",
    });

    const switching = switchToImpersonation("imp");
    const late = setTokensIfRefreshIs("admin-r", {
      authToken: "admin-a2",
      refreshToken: "admin-r2",
    });
    await switching;

    // The refresh started from the admin's session: dropped.
    await expect(late).resolves.toBe(false);
    expect(store["ffd.session.access"]).toBe("imp");
    expect(store["ffd.session.refresh"]).toBeUndefined();
  });
});

describe("restoreFromImpersonation (atomic)", () => {
  it("wipes the target's session and writes the admin's back, keeping the backup", async () => {
    const store = keychain({
      "ffd.session.access": "imp",
      "ffd.impersonation.access": "admin-a",
      "ffd.impersonation.refresh": "admin-r",
    });

    await expect(restoreFromImpersonation()).resolves.toBe(true);

    expect(store).toEqual({
      "ffd.session.access": "admin-a",
      "ffd.session.refresh": "admin-r",
      // Cleared by the caller once the preferences are written.
      "ffd.impersonation.access": "admin-a",
      "ffd.impersonation.refresh": "admin-r",
    });
    expect(asyncRemove).toHaveBeenCalledWith("@ffd/offline-queue");
  });

  it("an incomplete backup only wipes the target's session", async () => {
    const store = keychain({
      "ffd.session.access": "imp",
      "ffd.impersonation.access": "admin-a",
    });

    await expect(restoreFromImpersonation()).resolves.toBe(false);

    expect(store).toEqual({ "ffd.impersonation.access": "admin-a" });
  });

  it("an unreadable backup changes nothing", async () => {
    keychain({ "ffd.session.access": "imp" });
    getItemAsync.mockRejectedValue(LOCKED);

    const error: unknown = await restoreFromImpersonation().catch(
      (e: unknown) => e,
    );

    expect(isTokenStoreUnavailable(error)).toBe(true);
    expect((error as TokenStoreUnavailableError).locked).toBe(true);
    expect(deleteItemAsync).not.toHaveBeenCalled();
  });
});

describe("clearTokensIfRefreshIs (#598 review)", () => {
  it("ends the session the rejected refresh token belongs to, offline queue included", async () => {
    const store = keychain({
      "ffd.session.access": "a1",
      "ffd.session.refresh": "r1",
      "ffd.impersonation.access": "kept",
    });

    await expect(clearTokensIfRefreshIs("r1")).resolves.toBe(true);

    expect(store).toEqual({ "ffd.impersonation.access": "kept" });
    expect(asyncRemove).toHaveBeenCalledWith("@ffd/offline-queue");
  });

  it("never wipes a newer session (stale 401 after a new login)", async () => {
    const store = keychain({
      "ffd.session.access": "b-a",
      "ffd.session.refresh": "b-r",
    });

    await expect(clearTokensIfRefreshIs("r1")).resolves.toBe(false);

    expect(store).toEqual({
      "ffd.session.access": "b-a",
      "ffd.session.refresh": "b-r",
    });
    expect(asyncRemove).not.toHaveBeenCalled();
  });

  it("clears when the current value cannot be read (most likely that session)", async () => {
    keychain({});
    getItemAsync.mockRejectedValue(LOCKED);

    await expect(clearTokensIfRefreshIs("r1")).resolves.toBe(true);
    expect(deleteItemAsync).toHaveBeenCalledWith("ffd.session.refresh", OPTS);
  });

  it("exports the shared impersonation backup key", () => {
    expect(IMPERSONATION_BACKUP_KEY).toBe("impersonation_backup");
  });
});

describe("setTokensIfRefreshIs (#598 review)", () => {
  it("writes when the stored refresh token is still the one sent", async () => {
    const store = keychain({
      "ffd.session.access": "a1",
      "ffd.session.refresh": "r1",
    });

    await expect(
      setTokensIfRefreshIs("r1", { authToken: "a2", refreshToken: "r2" }),
    ).resolves.toBe(true);

    expect(store).toEqual({
      "ffd.session.access": "a2",
      "ffd.session.refresh": "r2",
    });
  });

  it("compares with a not-yet-migrated refresh token too", async () => {
    keychain({ "ffd.refreshToken": "r1" });

    await expect(
      setTokensIfRefreshIs("r1", { authToken: "a2", refreshToken: "r2" }),
    ).resolves.toBe(true);
  });

  it.each([
    ["another session", { "ffd.session.refresh": "other" }],
    ["a logout", {}],
  ])(
    "drops the rotated tokens after %s",
    async (_case, initial: Record<string, string>) => {
      const store = keychain(initial);

      await expect(
        setTokensIfRefreshIs("r1", { authToken: "a2", refreshToken: "r2" }),
      ).resolves.toBe(false);

      expect(store).toEqual(initial);
    },
  );

  it("persists anyway when the current value cannot be read (r1 is already revoked)", async () => {
    keychain({});
    getItemAsync.mockRejectedValue(LOCKED);

    await expect(
      setTokensIfRefreshIs("r1", { authToken: "a2", refreshToken: "r2" }),
    ).resolves.toBe(true);
    expect(setItemAsync).toHaveBeenCalledWith(
      "ffd.session.refresh",
      "r2",
      OPTS,
    );
  });
});
