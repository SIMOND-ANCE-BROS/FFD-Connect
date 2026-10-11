import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { AdminStatsController } from "./admin-stats.controller";
import type { AdminStatsQueryService } from "./admin-stats.query-service";

describe("AdminStatsController", () => {
  it("is ADMIN-only at class level", () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminStatsController)).toEqual([
      UserRole.ADMIN,
    ]);
  });

  it("defaults the period to 12w and passes a given one through", async () => {
    const get = jest.fn().mockResolvedValue({});
    const controller = new AdminStatsController({
      get,
    } as unknown as AdminStatsQueryService);
    await controller.get({});
    expect(get).toHaveBeenCalledWith("12w");
    await controller.get({ period: "6m" });
    expect(get).toHaveBeenLastCalledWith("6m");
  });
});
