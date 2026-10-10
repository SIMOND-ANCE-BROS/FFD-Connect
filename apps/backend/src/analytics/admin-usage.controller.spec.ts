import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { AdminUsageController } from "./admin-usage.controller";
import type { AdminUsageQueryService } from "./admin-usage.query-service";

describe("AdminUsageController", () => {
  it("is ADMIN-only at class level", () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminUsageController)).toEqual([
      UserRole.ADMIN,
    ]);
  });

  it("defaults to 30d and passes the space through", async () => {
    const get = jest.fn().mockResolvedValue({});
    const controller = new AdminUsageController({
      get,
    } as unknown as AdminUsageQueryService);
    await controller.get({});
    expect(get).toHaveBeenCalledWith("30d", undefined);
    await controller.get({ period: "7d", space: "CLUB" });
    expect(get).toHaveBeenLastCalledWith("7d", "CLUB");
  });
});
