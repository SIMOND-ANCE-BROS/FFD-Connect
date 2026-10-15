import { Reflector } from "@nestjs/core";
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { STORE_REVIEW_READ_KEY } from "../auth/store-review/store-review.decorator";
import { simulatedEmptyPage } from "../auth/store-review/store-review-responses";
import { ClubRefundsDueController } from "./club-refunds-due.controller";
import type { ClubRefundsDueQueryService } from "./club-refunds-due-query.service";

describe("ClubRefundsDueController (#516)", () => {
  const listForClubManager = jest.fn();
  const controller = new ClubRefundsDueController({
    listForClubManager,
  } as unknown as ClubRefundsDueQueryService);
  const req = { user: { userId: "user-1" } } as unknown as RequestWithUser;

  beforeEach(() => listForClubManager.mockReset());

  it("lists the requester's refunds with the requested page", async () => {
    const page = { data: [], meta: { total: 0, skip: 20, take: 10 } };
    listForClubManager.mockResolvedValue(page);

    await expect(controller.list(req, { skip: 20, take: 10 })).resolves.toBe(
      page,
    );
    expect(listForClubManager).toHaveBeenCalledWith("user-1", 20, 10);
  });

  it("leaves the default page to the service", async () => {
    await controller.list(req, {});

    expect(listForClubManager).toHaveBeenCalledWith(
      "user-1",
      undefined,
      undefined,
    );
  });

  it("is restricted to club accounts on the whole class", () => {
    const roles = new Reflector().get<UserRole[]>(
      ROLES_KEY,
      ClubRefundsDueController,
    );
    expect(roles).toEqual([UserRole.CLUB]);
  });

  it("serves an empty page to the store-review account", () => {
    const builder: unknown = new Reflector().get(
      STORE_REVIEW_READ_KEY,
      ClubRefundsDueController.prototype.list,
    );
    expect(builder).toBe(simulatedEmptyPage);
  });
});
