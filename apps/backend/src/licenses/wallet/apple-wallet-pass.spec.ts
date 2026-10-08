import {
  APPLE_PASS_DESCRIPTION,
  APPLE_PASS_ORGANIZATION_NAME,
  applePassSerialNumber,
  buildApplePassJson,
  parisEndOfDay,
} from "./apple-wallet-pass";

const license = {
  id: "lic-1",
  number: "FFD-42",
  category: "Loisir",
  validUntil: new Date("2026-12-31T12:00:00.000Z"),
  firstName: "Jean",
  lastName: "Dupont",
};

describe("parisEndOfDay", () => {
  it("summer time (UTC+2)", () => {
    expect(parisEndOfDay("2026-08-31").toISOString()).toBe(
      "2026-08-31T22:00:00.000Z",
    );
  });

  it("winter time (UTC+1)", () => {
    expect(parisEndOfDay("2026-12-31").toISOString()).toBe(
      "2026-12-31T23:00:00.000Z",
    );
  });

  it("the day before the spring DST switch ends at 00:00 CET", () => {
    // 2026-03-29 is the switch day: 2026-03-28 ends at 00:00 CET (UTC+1).
    expect(parisEndOfDay("2026-03-28").toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
  });

  it("the autumn DST switch day ends at 00:00 CET", () => {
    // 2026-10-25 03:00 CEST → 02:00 CET; the next midnight is CET.
    expect(parisEndOfDay("2026-10-25").toISOString()).toBe(
      "2026-10-25T23:00:00.000Z",
    );
  });
});

describe("buildApplePassJson", () => {
  const pass = buildApplePassJson({
    passTypeIdentifier: "pass.org.example.test",
    teamIdentifier: "TEST000000",
    license,
    qrMessage: '{"v":1,"id":"FFD-42","exp":"2026-12-31","sig":"x"}',
  });

  it("uses neutral labels (not an official federation card)", () => {
    expect(pass.organizationName).toBe(APPLE_PASS_ORGANIZATION_NAME);
    expect(pass.description).toBe(APPLE_PASS_DESCRIPTION);
    expect(JSON.stringify(pass)).not.toMatch(/officiel|fédération/i);
  });

  it("puts the QR message as-is in the only barcode", () => {
    expect(pass.barcodes).toEqual([
      {
        format: "PKBarcodeFormatQR",
        message: '{"v":1,"id":"FFD-42","exp":"2026-12-31","sig":"x"}',
        messageEncoding: "iso-8859-1",
        altText: "FFD-42",
      },
    ]);
  });

  it("shows holder, number, type and validity day", () => {
    expect(pass.generic.primaryFields[0].value).toBe("Jean Dupont");
    expect(pass.generic.secondaryFields.map((f) => f.value)).toEqual([
      "FFD-42",
      "Loisir",
    ]);
    expect(pass.generic.auxiliaryFields[0].value).toBe("31/12/2026");
    expect(pass.expirationDate).toBe("2026-12-31T23:00:00.000Z");
  });

  it("has a serial number stable per license", () => {
    expect(pass.serialNumber).toBe(applePassSerialNumber("lic-1"));
    expect(
      buildApplePassJson({
        passTypeIdentifier: "pass.org.example.test",
        teamIdentifier: "TEST000000",
        license: { ...license, validUntil: new Date("2027-08-31") },
        qrMessage: "other",
      }).serialNumber,
    ).toBe(pass.serialNumber);
  });

  it("falls back to the license number when the name is blank", () => {
    const anonymous = buildApplePassJson({
      passTypeIdentifier: "pass.org.example.test",
      teamIdentifier: "TEST000000",
      license: { ...license, firstName: "", lastName: "" },
      qrMessage: "q",
    });
    expect(anonymous.generic.primaryFields[0].value).toBe("FFD-42");
  });
});
