import { GUARDS_METADATA } from "@nestjs/common/constants";
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NoImpersonationGuard } from "../auth/no-impersonation.guard";
import { STORE_REVIEW_READ_KEY } from "../auth/store-review/store-review.decorator";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import { AdminTopTurnierController } from "./admin-topturnier.controller";
import type { CompetitionTopTurnierIndexQueryService } from "./services/competition-topturnier-index-query.service";

describe("AdminTopTurnierController (#801, temporary)", () => {
  it("is STAFF / ADMIN only, never impersonated, at class level", () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminTopTurnierController)).toEqual([
      UserRole.STAFF,
      UserRole.ADMIN,
    ]);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminTopTurnierController),
    ).toEqual([JwtAuthGuard, NoImpersonationGuard, RolesGuard]);
  });

  it("throttles the list per user and serves the store-review account empty", () => {
    const { competitions, status } = AdminTopTurnierController.prototype;
    expect(Reflect.getMetadata(GUARDS_METADATA, competitions)).toEqual([
      ThrottlerUserGuard,
    ]);
    const empty = Reflect.getMetadata(STORE_REVIEW_READ_KEY, competitions) as
      | (() => object)
      | undefined;
    expect(empty?.()).toEqual({ years: [], items: [], truncated: false });
    const off = Reflect.getMetadata(STORE_REVIEW_READ_KEY, status) as
      | (() => object)
      | undefined;
    expect(off?.()).toEqual({ enabled: false });
  });

  it("delegates to the query service", async () => {
    const list = jest.fn().mockResolvedValue({ years: [2026], items: [] });
    const isAvailable = jest.fn().mockReturnValue(true);
    const controller = new AdminTopTurnierController({
      list,
      isAvailable,
    } as unknown as CompetitionTopTurnierIndexQueryService);
    expect(controller.status()).toEqual({ enabled: true });
    await controller.competitions({ year: 2026 });
    expect(list).toHaveBeenCalledWith(2026);
    await controller.competitions({});
    expect(list).toHaveBeenLastCalledWith(undefined);
  });
});
