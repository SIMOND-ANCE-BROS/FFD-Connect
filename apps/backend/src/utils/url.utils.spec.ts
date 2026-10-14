import { normalizeExternalWebUrl } from "./url.utils";

describe("normalizeExternalWebUrl", () => {
  it.each([
    // FFD-CLIENT-7 (#583)
    ["www.cergy-danse.com", "https://www.cergy-danse.com"],
    ["  www.cergy-danse.com ", "https://www.cergy-danse.com"],
    ["club.fr/inscription?x=1", "https://club.fr/inscription?x=1"],
    ["//club.fr/a", "https://club.fr/a"],
    ["https://ffdanse.fr/a.pdf", "https://ffdanse.fr/a.pdf"],
    ["HTTP://Club.fr", "http://Club.fr"],
    [
      "https://club.fr/mon programme.pdf",
      "https://club.fr/mon%20programme.pdf",
    ],
  ])("%p → %p", (input, expected) => {
    expect(normalizeExternalWebUrl(input)).toBe(expected);
  });

  it.each([
    [undefined],
    [null],
    [""],
    ["  "],
    ["Voir le site du club"],
    ["/uploads/a.pdf"],
    ["ftp://club.fr"],
    ["javascript:alert(1)"],
    ["https://localhost"],
    ["www"],
  ])("%p → null", (input) => {
    expect(normalizeExternalWebUrl(input)).toBeNull();
  });
});
