import { NotificationType } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { UpdateNotificationPreferenceDto } from "./notification-preference.dto";

/**
 * Contraintes class-validator appliquées par la ValidationPipe globale
 * (whitelist + forbidNonWhitelisted) sur PATCH /notifications/preferences.
 */
describe("UpdateNotificationPreferenceDto", () => {
  const failedProperties = (payload: object) =>
    validateSync(plainToInstance(UpdateNotificationPreferenceDto, payload)).map(
      (error) => error.property,
    );

  it.each(Object.values(NotificationType))("accepte le type %s", (type) => {
    expect(failedProperties({ type, enabled: true })).toEqual([]);
  });

  it("refuse un type hors enum", () => {
    expect(failedProperties({ type: "NEWSLETTER", enabled: true })).toEqual([
      "type",
    ]);
  });

  it("refuse un type absent", () => {
    expect(failedProperties({ enabled: true })).toEqual(["type"]);
  });

  it("refuse un `enabled` absent", () => {
    expect(
      failedProperties({ type: NotificationType.NEW_COMPETITION }),
    ).toEqual(["enabled"]);
  });

  it('refuse un `enabled` non booléen, y compris la chaîne "false"', () => {
    // Un `"false"` accepté puis coercé serait le pire des cas : l'utilisateur
    // croit avoir coupé, la base enregistre une chaîne non vide.
    expect(
      failedProperties({
        type: NotificationType.NEW_COMPETITION,
        enabled: "false",
      }),
    ).toEqual(["enabled"]);
    expect(
      failedProperties({ type: NotificationType.NEW_COMPETITION, enabled: 0 }),
    ).toEqual(["enabled"]);
  });
});
