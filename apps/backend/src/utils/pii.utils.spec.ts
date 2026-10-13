import { maskEmail } from "./pii.utils";

describe("maskEmail", () => {
  it("keeps the first letters and the top-level domain only", () => {
    expect(maskEmail("jean.dupont@club-danse.fr")).toBe("j***@c***.fr");
  });

  it("keeps only the last label of a multi-level domain", () => {
    expect(maskEmail("a@mail.example.co.uk")).toBe("a***@m***.uk");
  });

  it("never echoes the local part nor the domain name", () => {
    const masked = maskEmail("secret.person@hidden-domain.com");
    expect(masked).not.toContain("secret");
    expect(masked).not.toContain("hidden");
  });

  it("handles a domain without a dot", () => {
    expect(maskEmail("root@localhost")).toBe("r***@l***");
  });

  it.each(["", "no-at-sign", "@domain.fr", "user@"])(
    "returns a fully masked value for a malformed address (%p)",
    (value) => {
      expect(maskEmail(value)).toBe("***");
    },
  );

  it("splits on the last @", () => {
    expect(maskEmail('"a@b"@x.fr')).toBe('"***@x***.fr');
  });
});
