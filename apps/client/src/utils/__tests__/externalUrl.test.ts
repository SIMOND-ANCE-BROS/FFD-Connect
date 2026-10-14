import { Alert, Linking } from "react-native";
import {
  normalizeExternalUrl,
  openExternalUrl,
  UNUSABLE_LINK_MESSAGE,
} from "../externalUrl";

describe("normalizeExternalUrl", () => {
  it.each([
    // FFD-CLIENT-7 (#583): scheme-less links from the FFD data
    ["www.cergy-danse.com", "https://www.cergy-danse.com"],
    ["  www.cergy-danse.com  ", "https://www.cergy-danse.com"],
    [
      "cergy-danse.com/inscription?x=1",
      "https://cergy-danse.com/inscription?x=1",
    ],
    ["//cdn.example.org/a.pdf", "https://cdn.example.org/a.pdf"],
    ["example.org:8443/a", "https://example.org:8443/a"],
    // already usable
    ["https://ffdanse.fr/a.pdf", "https://ffdanse.fr/a.pdf"],
    ["http://ffdanse.fr", "http://ffdanse.fr"],
    ["HTTPS://FFDanse.fr/A", "https://FFDanse.fr/A"],
    [
      "https://ffdanse.fr/mon programme.pdf",
      "https://ffdanse.fr/mon%20programme.pdf",
    ],
    ["mailto:club@example.org", "mailto:club@example.org"],
    ["tel:+33102030405", "tel:+33102030405"],
  ])("%p → %p", (input, expected) => {
    expect(normalizeExternalUrl(input)).toBe(expected);
  });

  it.each([
    [undefined],
    [null],
    [""],
    ["   "],
    ["/uploads/programme.pdf"],
    ["Voir le site du club"],
    ["ftp://example.org/a"],
    ["javascript:alert(1)"],
    ["https://"],
    ["https://localhost/a"],
    ["mailto:"],
    ["www"],
  ])("%p → undefined", (input) => {
    expect(normalizeExternalUrl(input)).toBeUndefined();
  });
});

describe("openExternalUrl", () => {
  let openURL: jest.SpyInstance;
  let alert: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("opens the normalized URL", async () => {
    await expect(openExternalUrl("www.cergy-danse.com")).resolves.toBe(true);
    expect(openURL).toHaveBeenCalledWith("https://www.cergy-danse.com");
    expect(alert).not.toHaveBeenCalled();
  });

  it("alerts instead of opening an unusable link", async () => {
    await expect(openExternalUrl("not a link")).resolves.toBe(false);
    expect(openURL).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      "Lien indisponible",
      UNUSABLE_LINK_MESSAGE,
    );
  });

  it("catches an OS refusal and alerts (no unhandled rejection)", async () => {
    openURL.mockRejectedValueOnce(
      new Error("Could not open URL: No Activity found to handle Intent"),
    );
    await expect(openExternalUrl("https://example.org")).resolves.toBe(false);
    expect(alert).toHaveBeenCalledWith(
      "Lien indisponible",
      UNUSABLE_LINK_MESSAGE,
    );
  });
});
