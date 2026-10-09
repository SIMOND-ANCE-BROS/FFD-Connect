import { MASKED_EMAIL, maskPersonalData } from "./store-review-masking";

const OWNER = "review-1";

describe("maskPersonalData", () => {
  describe("someone else's person record (allowlist, deny by default)", () => {
    it("keeps only safe fields and blanks everything else", () => {
      expect(
        maskPersonalData(
          {
            id: "u2",
            email: "jane@x.fr",
            firstName: "Jane",
            lastName: "doe",
            birthDate: new Date("1990-01-01"),
            role: "LICENSEE",
            clubName: "Club A",
            nationalRanking: 3,
            lastLoginAt: new Date(),
            someFutureColumn: "anything",
          },
          OWNER,
        ),
      ).toEqual({
        id: "u2",
        email: MASKED_EMAIL,
        firstName: "Jane",
        lastName: "D.",
        birthDate: null,
        role: "LICENSEE",
        clubName: "Club A",
        nationalRanking: null,
        lastLoginAt: null,
        someFutureColumn: null,
      });
    });

    it.each([
      ["mail", "a@x.fr", MASKED_EMAIL],
      ["contactEmail", "a@x.fr", MASKED_EMAIL],
      ["phoneNumber", "0600", null],
      ["dateOfBirth", "1990-01-01", null],
      ["address", "1 rue X", null],
      ["licenseNumber", "2000-abc", null],
    ])("closes the alternate-name bypass: %s", (key, value, expected) => {
      expect(
        maskPersonalData({ id: "u2", firstName: "A", [key]: value }, OWNER),
      ).toEqual({ id: "u2", firstName: "A", [key]: expected });
    });

    it("walks nested relations of a person and blanks sensitive containers", () => {
      expect(
        maskPersonalData(
          {
            id: "u2",
            firstName: "A",
            license: { number: "2000-abc", validUntil: "2027-01-01" },
            wdsf: { min: "1", nationality: "FR" },
            address: { street: "x", city: "y" },
          },
          OWNER,
        ),
      ).toEqual({
        id: "u2",
        firstName: "A",
        license: { number: "••••••", validUntil: "2027-01-01" },
        wdsf: { min: "1", nationality: "FR" },
        address: null,
      });
    });

    it("judges a person without id from its parent (foreign by default)", () => {
      expect(
        maskPersonalData(
          { id: "c1", proposedBy: { firstName: "A", lastName: "Bee" } },
          OWNER,
        ),
      ).toEqual({ id: "c1", proposedBy: { firstName: "A", lastName: "B." } });
    });
  });

  describe("any other foreign record", () => {
    it("blanks documents, QR codes, free text, IPs and tokens", () => {
      expect(
        maskPersonalData(
          [
            {
              id: "d1",
              type: "MEDICAL",
              filePath: "doc.jpg",
              ocrData: { a: 1 },
            },
            { id: "l1", qrCode: "q", qrCodeSignature: "s", wdsfMin: "1" },
            { id: "a1", ip: "1.2.3.4", message: "call me", reason: "x" },
            { id: "t1", token: "abc", refresh_token: "r" },
          ],
          OWNER,
        ),
      ).toEqual([
        { id: "d1", type: "MEDICAL", filePath: null, ocrData: null },
        { id: "l1", qrCode: null, qrCodeSignature: null, wdsfMin: null },
        { id: "a1", ip: null, message: null, reason: null },
        { id: "t1", token: null, refresh_token: null },
      ]);
    });

    it("masks email addresses inside any string (JSON-in-string, odd keys)", () => {
      expect(
        maskPersonalData(
          {
            id: "a1",
            before: '{"email":"old@x.fr"}',
            note: "contact jane.doe@club.org or bob@x.io",
          },
          OWNER,
        ),
      ).toEqual({
        id: "a1",
        before: `{"email":"${MASKED_EMAIL}"}`,
        note: `contact ${MASKED_EMAIL} or ${MASKED_EMAIL}`,
      });
    });

    it("masks a license number only under a license key", () => {
      expect(
        maskPersonalData(
          { id: "e1", number: 7, license: { number: null } },
          OWNER,
        ),
      ).toEqual({ id: "e1", number: 7, license: { number: null } });
    });

    it("leaves public, non-personal data alone", () => {
      const competition = {
        id: "comp-1",
        title: "Open de Lyon",
        date: "2026-10-09",
        events: [{ id: "e1", category: "Latin", results: [{ ranking: 1 }] }],
      };
      expect(maskPersonalData(competition, OWNER)).toEqual(competition);
    });
  });

  describe("the account's own records", () => {
    it("stay whole: profile and nested license (QR, number)", () => {
      const own = {
        id: OWNER,
        email: "licensee@test.com",
        lastName: "Licencié",
        birthDate: null,
        license: { number: "TEST-LICENSEE-001", qrCode: "q" },
      };
      expect(maskPersonalData(own, OWNER)).toEqual(own);
    });

    it("a record with the account's userId stays whole", () => {
      const lic = { userId: OWNER, number: "TEST", qrCode: "q" };
      expect(maskPersonalData({ license: lic }, OWNER)).toEqual({
        license: lic,
      });
    });

    it("a foreign person nested in an own record is still masked", () => {
      expect(
        maskPersonalData(
          {
            userId: OWNER,
            bibNumber: 12,
            partnerUser: { id: "u2", email: "p@x.fr", lastName: "Partner" },
          },
          OWNER,
        ),
      ).toEqual({
        userId: OWNER,
        bibNumber: 12,
        partnerUser: { id: "u2", email: MASKED_EMAIL, lastName: "P." },
      });
    });

    it("own-data routes start as owned, except foreign person records", () => {
      const body = [
        { id: "n1", title: "Inscription", body: "Contact: me@x.fr" },
        { id: "u9", email: "other@x.fr" },
      ];
      expect(maskPersonalData(body, OWNER, true)).toEqual([
        { id: "n1", title: "Inscription", body: "Contact: me@x.fr" },
        { id: "u9", email: MASKED_EMAIL },
      ]);
    });

    it("a foreign userId inside an own-data route is masked", () => {
      expect(
        maskPersonalData({ userId: "u2", token: "t" }, OWNER, true),
      ).toEqual({ userId: "u2", token: null });
    });
  });

  it("keeps null values and primitives, blanks a person's binary fields", () => {
    const buf = Buffer.from("x");
    expect(
      maskPersonalData(
        { id: "u2", email: null, lastName: "", file: buf, tags: [1, null] },
        OWNER,
      ),
    ).toEqual({
      id: "u2",
      email: null,
      lastName: null,
      file: null,
      tags: [1, null],
    });
    expect(maskPersonalData({ id: "t1", cover: buf }, OWNER)).toEqual({
      id: "t1",
      cover: buf,
    });
    expect(maskPersonalData(42, OWNER)).toBe(42);
    expect(maskPersonalData(null, OWNER)).toBeNull();
  });

  it("handles prototype-less objects", () => {
    const bare = Object.assign(Object.create(null) as object, {
      id: "u2",
      email: "a@x.fr",
    });
    expect(maskPersonalData(bare, OWNER)).toEqual({
      id: "u2",
      email: MASKED_EMAIL,
    });
  });

  it("cuts foreign data beyond a bounded depth, keeps own data", () => {
    let deep: Record<string, unknown> = { note: "a@x.fr" };
    for (let i = 0; i < 40; i++) deep = { child: deep };
    expect(JSON.stringify(maskPersonalData(deep, OWNER))).not.toContain(
      "a@x.fr",
    );
    expect(JSON.stringify(maskPersonalData(deep, OWNER, true))).toContain(
      "a@x.fr",
    );
  });

  it("never mutates its input", () => {
    const input = { id: "u2", email: "a@x.fr" };
    maskPersonalData(input, OWNER);
    expect(input.email).toBe("a@x.fr");
  });
});
