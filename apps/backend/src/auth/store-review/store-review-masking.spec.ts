import { MASKED_EMAIL, maskPersonalData } from "./store-review-masking";

const OWNER = "review-1";

describe("maskPersonalData", () => {
  it("masks contact data, birth date and last name of other people", () => {
    const birthDate = new Date("1990-01-01");
    expect(
      maskPersonalData(
        {
          id: "u2",
          email: "jane@x.fr",
          firstName: "Jane",
          lastName: "doe",
          birthDate,
          phone: "0600000000",
          address: "1 rue X",
          role: "LICENSEE",
        },
        OWNER,
      ),
    ).toEqual({
      id: "u2",
      email: MASKED_EMAIL,
      firstName: "Jane",
      lastName: "D.",
      birthDate: null,
      phone: null,
      address: null,
      role: "LICENSEE",
    });
  });

  it("walks paginated lists and nested relations", () => {
    const res = maskPersonalData(
      {
        data: [
          {
            id: "u2",
            email: "a@x.fr",
            license: { number: "2000-abc", validUntil: "2027-01-01" },
            licenseNumber: "2000-abc",
          },
        ],
        meta: { total: 1 },
      },
      OWNER,
    );
    expect(res).toEqual({
      data: [
        {
          id: "u2",
          email: MASKED_EMAIL,
          license: { number: "••••••", validUntil: "2027-01-01" },
          licenseNumber: "••••••",
        },
      ],
      meta: { total: 1 },
    });
  });

  it("blanks other people's documents, QR codes and audit JSON", () => {
    expect(
      maskPersonalData(
        [
          { id: "d1", filePath: "doc.jpg", ocrData: { name: "X" } },
          { id: "l1", qrCode: "q", qrCodeSignature: "s", wdsfMin: "1" },
          { id: "a1", ip: "1.2.3.4", before: { email: "old@x.fr" } },
        ],
        OWNER,
      ),
    ).toEqual([
      { id: "d1", filePath: null, ocrData: null },
      { id: "l1", qrCode: null, qrCodeSignature: null, wdsfMin: null },
      { id: "a1", ip: null, before: { email: MASKED_EMAIL } },
    ]);
  });

  it("leaves the account's own records whole (profile, license)", () => {
    const own = {
      id: OWNER,
      email: "licensee@test.com",
      lastName: "Licencié",
      license: { number: "TEST-LICENSEE-001", qrCode: "q" },
    };
    expect(maskPersonalData(own, OWNER)).toBe(own);
    const ownLicense = { userId: OWNER, number: "TEST", qrCode: "q" };
    expect(maskPersonalData({ license: ownLicense }, OWNER)).toEqual({
      license: ownLicense,
    });
  });

  it("keeps empty values, non-string last names and non-plain objects", () => {
    const buf = Buffer.from("x");
    const date = new Date();
    expect(
      maskPersonalData(
        {
          id: "u2",
          email: null,
          lastName: "",
          other: { lastName: 3 },
          file: buf,
          at: date,
          tags: ["a", 1, null],
        },
        OWNER,
      ),
    ).toEqual({
      id: "u2",
      email: null,
      lastName: "",
      other: { lastName: 3 },
      file: buf,
      at: date,
      tags: ["a", 1, null],
    });
  });

  it("masks a license number only under a license key", () => {
    expect(maskPersonalData({ id: "e1", number: 7 }, OWNER)).toEqual({
      id: "e1",
      number: 7,
    });
  });

  it("returns primitives and null untouched, and handles prototype-less objects", () => {
    expect(maskPersonalData("text", OWNER)).toBe("text");
    expect(maskPersonalData(null, OWNER)).toBeNull();
    const bare = Object.assign(Object.create(null) as object, {
      email: "a@x.fr",
    });
    expect(maskPersonalData(bare, OWNER)).toEqual({ email: MASKED_EMAIL });
  });

  it("stops at a bounded depth", () => {
    let deep: Record<string, unknown> = { email: "deep@x.fr" };
    for (let i = 0; i < 40; i++) deep = { child: deep };
    const res = maskPersonalData(deep, OWNER) as Record<string, unknown>;
    expect(res).toBeDefined();
  });

  it("never mutates its input", () => {
    const input = { id: "u2", email: "a@x.fr" };
    maskPersonalData(input, OWNER);
    expect(input.email).toBe("a@x.fr");
  });
});
