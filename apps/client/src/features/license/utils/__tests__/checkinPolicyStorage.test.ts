import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CHECKIN_POLICY_MAX_ENTRIES,
  loadCheckinPolicy,
  saveCheckinPolicy,
} from "../checkinPolicyStorage";

describe("checkinPolicyStorage (#668)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it("returns null for a competition never fetched on this device", async () => {
    await expect(loadCheckinPolicy("c1")).resolves.toBeNull();
  });

  it("keeps the policy of each competition apart", async () => {
    await saveCheckinPolicy("c1", { requireRotatingQr: true });
    await saveCheckinPolicy("c2", { requireRotatingQr: false });
    await expect(loadCheckinPolicy("c1")).resolves.toEqual({
      requireRotatingQr: true,
    });
    await expect(loadCheckinPolicy("c2")).resolves.toEqual({
      requireRotatingQr: false,
    });
  });

  it("overwrites a competition's policy when it is refreshed", async () => {
    await saveCheckinPolicy("c1", { requireRotatingQr: true });
    await saveCheckinPolicy("c1", { requireRotatingQr: false });
    await expect(loadCheckinPolicy("c1")).resolves.toEqual({
      requireRotatingQr: false,
    });
  });

  it("keeps only the most recently refreshed competitions", async () => {
    const start = Date.UTC(2026, 9, 16);
    for (let i = 0; i <= CHECKIN_POLICY_MAX_ENTRIES; i++) {
      await saveCheckinPolicy(
        `c${i}`,
        { requireRotatingQr: true },
        new Date(start + i * 1000),
      );
    }
    await expect(loadCheckinPolicy("c0")).resolves.toBeNull();
    await expect(
      loadCheckinPolicy(`c${CHECKIN_POLICY_MAX_ENTRIES}`),
    ).resolves.toEqual({ requireRotatingQr: true });
  });

  it("ignores malformed entries and unreadable storage", async () => {
    await AsyncStorage.setItem(
      "checkin_policy_v1",
      JSON.stringify({ c1: { requireRotatingQr: "yes" }, c2: null }),
    );
    await expect(loadCheckinPolicy("c1")).resolves.toBeNull();
    await AsyncStorage.setItem("checkin_policy_v1", "{not json");
    await expect(loadCheckinPolicy("c1")).resolves.toBeNull();
    await AsyncStorage.setItem("checkin_policy_v1", "42");
    await expect(loadCheckinPolicy("c1")).resolves.toBeNull();
  });

  it("never throws when the storage fails", async () => {
    jest
      .spyOn(AsyncStorage, "setItem")
      .mockRejectedValueOnce(new Error("disk full"));
    await expect(
      saveCheckinPolicy("c1", { requireRotatingQr: true }),
    ).resolves.toBeUndefined();
  });
});
