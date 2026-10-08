/** Contenu du QR de licence (#168). */
import { buildLicenseQrData } from "../licenseQrData";

const USER = {
  firstName: "Alice",
  lastName: "Dupont",
  licenseNumber: "FFD-12345",
  type: "Athlète",
  validUntil: "31/08/2026",
  birthDate: "15/06/1995",
};

describe("buildLicenseQrData", () => {
  it("affiche tel quel le QR signé fourni par le serveur", () => {
    const qrCode = '{"v":1,"id":"FFD-12345","exp":"2026-08-31","sig":"abc"}';
    expect(buildLicenseQrData({ ...USER, qrCode }, "FFD")).toBe(qrCode);
  });

  it("retombe sur l'ancien contenu sans QR signé (backend ancien)", () => {
    expect(JSON.parse(buildLicenseQrData(USER, "FFD"))).toEqual({
      id: "FFD-12345",
      name: "Dupont Alice",
      valid: true,
      type: "FFD",
    });
  });

  it("ignore un QR signé vide", () => {
    expect(
      JSON.parse(buildLicenseQrData({ ...USER, qrCode: "" }, "FFD")),
    ).toMatchObject({ id: "FFD-12345" });
  });
});
