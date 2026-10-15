import AsyncStorage from "@react-native-async-storage/async-storage";
import type { EntryQrBatch, EntryQrKeySet } from "../entryQr";
import {
  clearEntryQrBatch,
  loadEntryQrBatch,
  loadEntryQrKeys,
  saveEntryQrBatch,
  saveEntryQrKeys,
} from "../entryQrStorage";
import { clearLicenseSnapshot } from "../licenseSnapshot";

const BATCH: EntryQrBatch = {
  version: 3,
  keyId: "b3N-LHLYjEQ",
  licenseId: "lic-1",
  number: "FFD-1",
  holderName: "DUPONT Jean",
  stepSeconds: 30,
  toleranceSteps: 1,
  firstStep: 1,
  signatures: ["s"],
  coversUntil: "2026-10-16T20:00:00.000Z",
};

const KEYS: EntryQrKeySet = {
  version: 3,
  stepSeconds: 30,
  toleranceSteps: 1,
  keys: [{ kid: "k", publicKey: "p", active: true }],
};

describe("entryQrStorage (#24)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("serves the batch back to the account that saved it only", async () => {
    await saveEntryQrBatch(" Jean@Example.com ", BATCH);
    expect(await loadEntryQrBatch("jean@example.com")).toEqual(BATCH);
    expect(await loadEntryQrBatch("marie@example.com")).toBeNull();
    expect(await loadEntryQrBatch(undefined)).toBeNull();
  });

  it("saves nothing without an account", async () => {
    await saveEntryQrBatch("  ", BATCH);
    expect(await AsyncStorage.getItem("entry_qr_batch_v1")).toBeNull();
  });

  it("ignores unreadable or malformed batches", async () => {
    await AsyncStorage.setItem("entry_qr_batch_v1", "{not json");
    expect(await loadEntryQrBatch("jean@example.com")).toBeNull();
    await AsyncStorage.setItem(
      "entry_qr_batch_v1",
      JSON.stringify({ owner: "jean@example.com", batch: { keyId: 1 } }),
    );
    expect(await loadEntryQrBatch("jean@example.com")).toBeNull();
    await AsyncStorage.setItem("entry_qr_batch_v1", "null");
    expect(await loadEntryQrBatch("jean@example.com")).toBeNull();
  });

  it("is purged with the licence snapshot (logout)", async () => {
    await saveEntryQrBatch("jean@example.com", BATCH);
    await clearLicenseSnapshot();
    expect(await loadEntryQrBatch("jean@example.com")).toBeNull();
  });

  it("clears the batch on demand", async () => {
    await saveEntryQrBatch("jean@example.com", BATCH);
    await clearEntryQrBatch();
    expect(await loadEntryQrBatch("jean@example.com")).toBeNull();
  });

  it("caches the public keys", async () => {
    expect(await loadEntryQrKeys()).toBeNull();
    await saveEntryQrKeys(KEYS);
    expect(await loadEntryQrKeys()).toEqual(KEYS);
  });

  it("ignores malformed cached keys", async () => {
    await AsyncStorage.setItem("entry_qr_keys_v1", JSON.stringify({ keys: 1 }));
    expect(await loadEntryQrKeys()).toBeNull();
    await AsyncStorage.setItem("entry_qr_keys_v1", "{oops");
    expect(await loadEntryQrKeys()).toBeNull();
  });

  it("survives a failing storage", async () => {
    const setItem = jest
      .spyOn(AsyncStorage, "setItem")
      .mockRejectedValue(new Error("disk full"));
    const removeItem = jest
      .spyOn(AsyncStorage, "removeItem")
      .mockRejectedValue(new Error("disk full"));
    await expect(saveEntryQrBatch("jean", BATCH)).resolves.toBeUndefined();
    await expect(saveEntryQrKeys(KEYS)).resolves.toBeUndefined();
    await expect(clearEntryQrBatch()).resolves.toBeUndefined();
    setItem.mockRestore();
    removeItem.mockRestore();
  });
});
