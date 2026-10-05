import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import {
  clearTokens,
  getAccessToken,
  getTokens,
  setTokens,
} from "../tokenStore";

jest.mock("expo-secure-store", () => ({
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

beforeEach(() => {
  jest.clearAllMocks();
  setItemAsync.mockResolvedValue(undefined);
  deleteItemAsync.mockResolvedValue(undefined);
  asyncSet.mockResolvedValue(undefined);
});

describe("tokenStore", () => {
  it("reads both tokens from SecureStore", async () => {
    getItemAsync.mockImplementation((k: string) =>
      Promise.resolve(k === "ffd.authToken" ? "a" : "r"),
    );
    await expect(getTokens()).resolves.toEqual({
      authToken: "a",
      refreshToken: "r",
    });
  });

  it("getAccessToken returns the access token", async () => {
    getItemAsync.mockImplementation((k: string) =>
      Promise.resolve(k === "ffd.authToken" ? "a" : null),
    );
    await expect(getAccessToken()).resolves.toBe("a");
  });

  it("setTokens writes only provided values (never deletes on undefined)", async () => {
    await setTokens({ authToken: "a" });
    expect(setItemAsync).toHaveBeenCalledWith("ffd.authToken", "a");
    expect(setItemAsync).toHaveBeenCalledTimes(1);
    expect(deleteItemAsync).not.toHaveBeenCalled();
  });

  it("clearTokens deletes both keys", async () => {
    await clearTokens();
    expect(deleteItemAsync).toHaveBeenCalledWith("ffd.authToken");
    expect(deleteItemAsync).toHaveBeenCalledWith("ffd.refreshToken");
  });

  it("clearTokens also drops the offline queue (#416)", async () => {
    // Every session end funnels through here — logout, an expired refresh
    // token, an impersonation switch. A surviving entry would be replayed
    // with the NEXT account's token.
    await clearTokens();
    expect(asyncRemove).toHaveBeenCalledWith("@ffd/offline-queue");
  });

  it("migrates legacy tokens from AsyncStorage when SecureStore is empty", async () => {
    getItemAsync.mockResolvedValue(null); // SecureStore empty
    asyncGet.mockResolvedValue(
      JSON.stringify({ authToken: "la", refreshToken: "lr", role: "LICENSEE" }),
    );

    const tokens = await getTokens();

    expect(tokens).toEqual({ authToken: "la", refreshToken: "lr" });
    expect(setItemAsync).toHaveBeenCalledWith("ffd.authToken", "la");
    expect(setItemAsync).toHaveBeenCalledWith("ffd.refreshToken", "lr");
    // Legacy blob rewritten without the secrets, preferences preserved.
    const rewritten = JSON.parse(asyncSet.mock.calls[0][1] as string);
    expect(rewritten.authToken).toBeUndefined();
    expect(rewritten.refreshToken).toBeUndefined();
    expect(rewritten.role).toBe("LICENSEE");
  });

  it("returns empty when neither store has tokens", async () => {
    getItemAsync.mockResolvedValue(null);
    asyncGet.mockResolvedValue(null);
    await expect(getTokens()).resolves.toEqual({});
  });
});
