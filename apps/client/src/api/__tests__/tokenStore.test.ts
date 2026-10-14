import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import {
  clearTokens,
  getAccessToken,
  getTokens,
  setTokens,
} from "../tokenStore";
import {
  TokenStoreUnavailableError,
  isTokenStoreUnavailable,
} from "../tokenStoreErrors";

jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: 0,
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

const OPTS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
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
