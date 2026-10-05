import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  DEVICE_TOKEN_MAX_LENGTH,
  RegisterDeviceTokenDto,
  UnregisterDeviceTokenDto,
} from "./device-token.dto";

/**
 * Vérifie les contraintes class-validator des DTO device-token : ce sont elles
 * que la ValidationPipe globale (whitelist + forbidNonWhitelisted) applique sur
 * les deux endpoints publics.
 */
describe("device-token DTOs", () => {
  const VALID_TOKEN = "fJ8kQm2xTZm4:APA91bFxq0Zx-token-de-registration";

  const failedProperties = (payload: object, dto: "register" | "unregister") =>
    validateSync(
      dto === "register"
        ? plainToInstance(RegisterDeviceTokenDto, payload)
        : plainToInstance(UnregisterDeviceTokenDto, payload),
    ).map((error) => error.property);

  describe("RegisterDeviceTokenDto", () => {
    it.each(["IOS", "ANDROID"])("accepte la plateforme %s", (platform) => {
      expect(
        failedProperties({ token: VALID_TOKEN, platform }, "register"),
      ).toEqual([]);
    });

    it("refuse une plateforme hors enum", () => {
      expect(
        failedProperties({ token: VALID_TOKEN, platform: "WEB" }, "register"),
      ).toEqual(["platform"]);
    });

    it("refuse une plateforme absente", () => {
      expect(failedProperties({ token: VALID_TOKEN }, "register")).toEqual([
        "platform",
      ]);
    });

    it("refuse un token absent, vide ou non-string", () => {
      expect(failedProperties({ platform: "IOS" }, "register")).toEqual([
        "token",
      ]);
      expect(
        failedProperties({ token: "", platform: "IOS" }, "register"),
      ).toEqual(["token"]);
      expect(
        failedProperties({ token: 42, platform: "IOS" }, "register"),
      ).toEqual(["token"]);
    });

    it("borne la longueur du token", () => {
      expect(
        failedProperties(
          { token: "a".repeat(DEVICE_TOKEN_MAX_LENGTH), platform: "IOS" },
          "register",
        ),
      ).toEqual([]);
      expect(
        failedProperties(
          { token: "a".repeat(DEVICE_TOKEN_MAX_LENGTH + 1), platform: "IOS" },
          "register",
        ),
      ).toEqual(["token"]);
    });
  });

  describe("UnregisterDeviceTokenDto", () => {
    it("accepte un token seul", () => {
      expect(failedProperties({ token: VALID_TOKEN }, "unregister")).toEqual(
        [],
      );
    });

    it("refuse un token absent ou vide", () => {
      expect(failedProperties({}, "unregister")).toEqual(["token"]);
      expect(failedProperties({ token: "" }, "unregister")).toEqual(["token"]);
    });

    it("borne la longueur du token", () => {
      expect(
        failedProperties(
          { token: "a".repeat(DEVICE_TOKEN_MAX_LENGTH + 1) },
          "unregister",
        ),
      ).toEqual(["token"]);
    });
  });
});
