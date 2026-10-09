import { GUARDS_METADATA } from "@nestjs/common/constants";
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AdminTracksController } from "./admin-tracks.controller";
import { AdminTracksQueryService } from "./admin-tracks.query-service";

describe("AdminTracksController", () => {
  const query = { list: jest.fn(), detail: jest.fn() };
  const controller = new AdminTracksController(
    query as unknown as AdminTracksQueryService,
  );

  beforeEach(() => jest.clearAllMocks());

  it("is guarded and restricted to ADMIN at class level", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminTracksController)).toEqual(
      [JwtAuthGuard, RolesGuard],
    );
    expect(Reflect.getMetadata(ROLES_KEY, AdminTracksController)).toEqual([
      UserRole.ADMIN,
    ]);
  });

  it("lists the catalogue with the filters", async () => {
    query.list.mockResolvedValue({ data: [], meta: {} });
    const filters = { ambiance: false, skip: 0, take: 50 };
    await expect(controller.list(filters)).resolves.toEqual({
      data: [],
      meta: {},
    });
    expect(query.list).toHaveBeenCalledWith(filters);
  });

  it("returns one track", async () => {
    query.detail.mockResolvedValue({ id: "t1" });
    await expect(controller.findOne("t1")).resolves.toEqual({ id: "t1" });
    expect(query.detail).toHaveBeenCalledWith("t1");
  });
});
