import { randomUUID } from "crypto";
import { TestingModule } from "@nestjs/testing";
import { NotificationType, UserRole } from "@prisma/client";
import {
  CONFIGURABLE_NOTIFICATION_TYPES,
  isEnabledByDefault,
} from "../src/notifications/notification-catalog";
import { NotificationPreferencesQueryService } from "../src/notifications/notification-preferences.query-service";
import { PrismaService } from "../src/prisma/prisma.service";
import { buildServiceModule } from "./integration-app.builder";

/**
 * The catalogue read is bounded by the number of configurable types. On a
 * real database, rows of every OTHER enum value (non-configurable, or made
 * configurable by a later revision and left behind by a rollback, #269) must
 * not take the place of a real switch.
 */
describe("Notification preferences catalogue (integration, real DB)", () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let userId: string;

  beforeAll(async () => {
    ({ module, prisma } = await buildServiceModule());
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@test.local`,
        password: "x",
        firstName: "Test",
        lastName: "Preferences",
        role: UserRole.ADMIN,
      },
      select: { id: true },
    });
    userId = user.id;
  });

  afterEach(async () => {
    // Cascades to the preferences.
    await prisma.user.delete({ where: { id: userId } });
  });

  afterAll(async () => {
    await module.close();
  });

  it("reads every stored switch, whatever rows of other types exist", async () => {
    // One row per enum value, each configurable one set AGAINST its default,
    // so that a row lost to the bound would show as the default.
    await prisma.notificationPreference.createMany({
      data: Object.values(NotificationType).map((type) => ({
        userId,
        type,
        enabled: !isEnabledByDefault(type),
      })),
    });
    const extra = Object.values(NotificationType).filter(
      (type) => !CONFIGURABLE_NOTIFICATION_TYPES.includes(type),
    );
    // At least one row the catalogue must ignore.
    expect(extra.length).toBeGreaterThan(0);

    const catalog = await module
      .get(NotificationPreferencesQueryService)
      .getCatalogForUser(userId, Object.values(UserRole));

    expect(catalog.map((entry) => entry.type)).toEqual([
      ...CONFIGURABLE_NOTIFICATION_TYPES,
    ]);
    for (const entry of catalog) {
      expect({ type: entry.type, enabled: entry.enabled }).toEqual({
        type: entry.type,
        enabled: !isEnabledByDefault(entry.type),
      });
    }
  });
});
