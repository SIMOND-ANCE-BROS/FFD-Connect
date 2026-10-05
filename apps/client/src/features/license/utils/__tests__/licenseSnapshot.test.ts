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

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("licenseSnapshot", () => {
  it("null quand aucun snapshot n'existe", async () => {
    expect(await loadLicenseSnapshot()).toBeNull();
  });

  it("sauvegarde puis relit la licence (avec date de synchro)", async () => {
    await saveLicenseSnapshot(FFD_USER, null);

    const snapshot = await loadLicenseSnapshot();
    expect(snapshot?.ffdUser).toEqual(FFD_USER);
    expect(snapshot?.wdsfUser).toBeNull();
    // savedAt est une date ISO valide
    expect(Number.isNaN(new Date(snapshot!.savedAt).getTime())).toBe(false);
  });

  it("conserve la licence WDSF quand elle existe", async () => {
    const wdsf = { ...FFD_USER, structure: "WDSF", licenseNumber: "10117265" };
    await saveLicenseSnapshot(FFD_USER, wdsf);

    const snapshot = await loadLicenseSnapshot();
    expect(snapshot?.wdsfUser?.licenseNumber).toBe("10117265");
  });

  it("clearLicenseSnapshot purge la PII locale (logout)", async () => {
    await saveLicenseSnapshot(FFD_USER, null);
    await clearLicenseSnapshot();
    expect(await loadLicenseSnapshot()).toBeNull();
  });

  it("snapshot corrompu → null (pas de crash)", async () => {
    await AsyncStorage.setItem("license_snapshot_v1", "{not json");
    expect(await loadLicenseSnapshot()).toBeNull();
  });
});
