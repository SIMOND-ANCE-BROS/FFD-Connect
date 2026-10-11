import { getLicenseValidityRow } from "../licenseValidity";

describe("getLicenseValidityRow", () => {
  it("shows a WDSF expiry date under the expiry label", () => {
    expect(
      getLicenseValidityRow(false, { validUntil: "31 décembre 2026" }),
    ).toEqual({ label: "License expires on", value: "31 décembre 2026" });
  });

  it("shows the WDSF status under the status label when there is no expiry date", () => {
    expect(
      getLicenseValidityRow(false, { validUntil: "", status: "Active" }),
    ).toEqual({ label: "License status", value: "Active" });
  });

  it("never pairs the expiry label with a status stored in validUntil (old snapshot)", () => {
    expect(getLicenseValidityRow(false, { validUntil: "Active" })).toEqual({
      label: "License status",
      value: "Active",
    });
    expect(getLicenseValidityRow(true, { validUntil: "PERMANENT" })).toEqual({
      label: "Statut de la licence",
      value: "PERMANENT",
    });
  });

  it("uses the French labels on the FFD card", () => {
    expect(getLicenseValidityRow(true, { validUntil: "31/08/2026" })).toEqual({
      label: "Licence valable jusqu'au",
      value: "31/08/2026",
    });
    expect(
      getLicenseValidityRow(true, { validUntil: "", status: "Permanente" }),
    ).toEqual({ label: "Statut de la licence", value: "Permanente" });
  });

  it("falls back to a dash when neither a date nor a status is known", () => {
    expect(getLicenseValidityRow(false, { validUntil: "" })).toEqual({
      label: "License status",
      value: "—",
    });
  });
});
