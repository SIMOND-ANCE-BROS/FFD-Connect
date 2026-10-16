import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { STORE_REVIEW_READ_KEY } from "../auth/store-review/store-review.decorator";
import { simulatedEmptyPage } from "../auth/store-review/store-review-responses";
import { AdminRefundsDueController } from "./admin-refunds-due.controller";
import type { AdminRefundsDueQueryService } from "./admin-refunds-due-query.service";

describe("AdminRefundsDueController (#627)", () => {
  const list = jest.fn();
  const controller = new AdminRefundsDueController({
    list,
  } as unknown as AdminRefundsDueQueryService);

  it("passes the query to the service", async () => {
    const page = { data: [], meta: { total: 0, skip: 0, take: 20 } };
    list.mockResolvedValue(page);
    const query = { skip: 20, take: 10, sortBy: "club" as const };

    await expect(controller.list(query)).resolves.toBe(page);
    expect(list).toHaveBeenCalledWith(query);
  });

  it("is restricted to authenticated administrators on the whole class", () => {
    expect(
      new Reflector().get<UserRole[]>(ROLES_KEY, AdminRefundsDueController),
    ).toEqual([UserRole.ADMIN]);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminRefundsDueController),
    ).toEqual([JwtAuthGuard, RolesGuard]);
  });

  it("serves an empty page to the store-review account", () => {
    const builder: unknown = new Reflector().get(
      STORE_REVIEW_READ_KEY,
      AdminRefundsDueController.prototype.list,
    );
    expect(builder).toBe(simulatedEmptyPage);
  });
});
