/** Snapshot E-Licence hors-ligne (#416). */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearLicenseSnapshot,
  loadLicenseSnapshot,
  saveLicenseSnapshot,
} from "../licenseSnapshot";

const FFD_USER = {
  firstName: "Alice",
  lastName: "Dupont",
  licenseNumber: "FFD-12345",
  type: "Athlète",
  structure: "Club Test",
  validUntil: "31/08/2026",
  validUntilRaw: "2026-08-31T00:00:00.000Z",
  season: "2025/2026",
  birthDate: "15/06/1995",
};

const OWNER = "alice@ffd.fr";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("licenseSnapshot", () => {
  it("null quand aucun snapshot n'existe", async () => {
    expect(await loadLicenseSnapshot(OWNER)).toBeNull();
  });

  it("sauvegarde puis relit la licence (avec date de synchro)", async () => {
    await saveLicenseSnapshot(OWNER, FFD_USER, null);

    const snapshot = await loadLicenseSnapshot(OWNER);
    expect(snapshot?.ffdUser).toEqual(FFD_USER);
    expect(snapshot?.wdsfUser).toBeNull();
    // savedAt est une date ISO valide
    expect(Number.isNaN(new Date(snapshot!.savedAt).getTime())).toBe(false);
  });

  it("conserve la licence WDSF quand elle existe", async () => {
    const wdsf = { ...FFD_USER, structure: "WDSF", licenseNumber: "10117265" };
    await saveLicenseSnapshot(OWNER, FFD_USER, wdsf);

    const snapshot = await loadLicenseSnapshot(OWNER);
    expect(snapshot?.wdsfUser?.licenseNumber).toBe("10117265");
  });

  it("garde le QR signé pour l'E-Licence hors ligne (#168)", async () => {
    const qrCode = '{"v":1,"id":"FFD-12345","exp":"2026-08-31","sig":"abc"}';
    await saveLicenseSnapshot(OWNER, { ...FFD_USER, qrCode }, null);

    const snapshot = await loadLicenseSnapshot(OWNER);
    expect(snapshot?.ffdUser.qrCode).toBe(qrCode);
  });

  it("clearLicenseSnapshot purge la PII locale (logout)", async () => {
    await saveLicenseSnapshot(OWNER, FFD_USER, null);
    await clearLicenseSnapshot();
    expect(await loadLicenseSnapshot(OWNER)).toBeNull();
  });

  it("stores the owner it belongs to (normalized)", async () => {
    await saveLicenseSnapshot("  Alice@FFD.fr ", FFD_USER, null);

    const snapshot = await loadLicenseSnapshot(OWNER);
    expect(snapshot?.owner).toBe(OWNER);
  });

  it("never serves another account's snapshot (A saved, C asks)", async () => {
    await saveLicenseSnapshot(OWNER, FFD_USER, null);
    expect(await loadLicenseSnapshot("charlie@ffd.fr")).toBeNull();
  });

  it("ignores a legacy snapshot written without owner", async () => {
    await AsyncStorage.setItem(
      "license_snapshot_v1",
      JSON.stringify({
        savedAt: "2026-10-01T10:00:00.000Z",
        ffdUser: FFD_USER,
        wdsfUser: null,
      }),
    );
    expect(await loadLicenseSnapshot(OWNER)).toBeNull();
  });

  it("serves nothing without a current identity", async () => {
    await saveLicenseSnapshot(OWNER, FFD_USER, null);
    expect(await loadLicenseSnapshot(undefined)).toBeNull();
    expect(await loadLicenseSnapshot("  ")).toBeNull();
  });

  it("does not save without an owner", async () => {
    await saveLicenseSnapshot(undefined, FFD_USER, null);
    expect(await AsyncStorage.getItem("license_snapshot_v1")).toBeNull();
  });

  it("JSON null → null", async () => {
    await AsyncStorage.setItem("license_snapshot_v1", "null");
    expect(await loadLicenseSnapshot(OWNER)).toBeNull();
  });

  it("snapshot corrompu → null (pas de crash)", async () => {
    await AsyncStorage.setItem("license_snapshot_v1", "{not json");
    expect(await loadLicenseSnapshot(OWNER)).toBeNull();
  });
});
