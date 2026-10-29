import { GUARDS_METADATA } from "@nestjs/common/constants";
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { STORE_REVIEW_READABLE_KEY } from "../auth/store-review/store-review.decorator";
import { AdminCompetitionsController } from "./admin-competitions.controller";
import type { CompetitionResultsStatusQueryService } from "./services/competition-results-status-query.service";

describe("AdminCompetitionsController (#846)", () => {
  it("is STAFF / ADMIN only, at class level", () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminCompetitionsController)).toEqual(
      [UserRole.STAFF, UserRole.ADMIN],
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminCompetitionsController),
    ).toEqual([JwtAuthGuard, RolesGuard]);
  });

  it("is not on the store-review read allowlist", () => {
    expect(
      Reflect.getMetadata(
        STORE_REVIEW_READABLE_KEY,
        AdminCompetitionsController.prototype.resultsStatusList,
      ),
    ).toBeUndefined();
  });

  it("delegates to the query service", async () => {
    const getStatuses = jest.fn().mockResolvedValue([]);
    const controller = new AdminCompetitionsController({
      getStatuses,
    } as unknown as CompetitionResultsStatusQueryService);
    await expect(controller.resultsStatusList({ ids: ["a"] })).resolves.toEqual(
      [],
    );
    expect(getStatuses).toHaveBeenCalledWith(["a"]);
  });
});
