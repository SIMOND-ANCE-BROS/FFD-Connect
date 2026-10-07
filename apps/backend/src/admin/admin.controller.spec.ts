import { GUARDS_METADATA } from "@nestjs/common/constants";
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { RolesGuard } from "../auth/guards/roles.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AdminAuditService } from "./admin-audit.service";
import { AdminClubAccountsService } from "./admin-club-accounts.service";
import { AdminReferenceService } from "./admin-reference.service";
import { AdminUsersQueryService } from "./admin-users.query-service";
import { AdminUsersService } from "./admin-users.service";
import { AdminController } from "./admin.controller";
import type { CreateClubAccountDto } from "./dto/club-account.dto";
import type { UpdateAdminUserDto } from "./dto/update-admin-user.dto";

describe("AdminController", () => {
  const audit = { list: jest.fn() };
  const reference = { referenceData: jest.fn(), clubs: jest.fn() };
  const usersQuery = { list: jest.fn(), detail: jest.fn() };
  const users = { update: jest.fn() };
  const clubAccounts = { create: jest.fn(), resendInvitation: jest.fn() };

  const controller = new AdminController(
    audit as unknown as AdminAuditService,
    reference as unknown as AdminReferenceService,
    usersQuery as unknown as AdminUsersQueryService,
    users as unknown as AdminUsersService,
    clubAccounts as unknown as AdminClubAccountsService,
  );

  const req = {
    user: { userId: "admin-1", role: UserRole.ADMIN, email: "a@test.com" },
  } as unknown as RequestWithUser;

  beforeEach(() => jest.clearAllMocks());

  it("is guarded and restricted to ADMIN at class level", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, AdminController)).toEqual([
      UserRole.ADMIN,
    ]);
  });

  it("returns reference data", () => {
    reference.referenceData.mockReturnValue({ roles: [] });
    expect(controller.referenceData()).toEqual({ roles: [] });
  });

  it("lists clubs", async () => {
    reference.clubs.mockResolvedValue([{ id: "c1", name: "Club" }]);
    await expect(controller.clubs()).resolves.toEqual([
      { id: "c1", name: "Club" },
    ]);
  });

  it("delegates the audit log query", async () => {
    audit.list.mockResolvedValue({ data: [] });
    const query = { skip: 0, take: 10 };
    await controller.auditLog(query);
    expect(audit.list).toHaveBeenCalledWith(query);
  });

  it("delegates the users list", async () => {
    usersQuery.list.mockResolvedValue({ data: [] });
    const query = { skip: 0, take: 10 };
    await controller.listUsers(query);
    expect(usersQuery.list).toHaveBeenCalledWith(query);
  });

  it("delegates the user detail", async () => {
    usersQuery.detail.mockResolvedValue({ id: "u1" });
    await expect(controller.getUser("u1")).resolves.toEqual({ id: "u1" });
    expect(usersQuery.detail).toHaveBeenCalledWith("u1");
  });

  it("passes the acting admin id when updating a user", async () => {
    users.update.mockResolvedValue({ id: "u1" });
    const dto = { firstName: "A" } as UpdateAdminUserDto;
    await controller.updateUser("u1", dto, req);
    expect(users.update).toHaveBeenCalledWith("admin-1", "u1", dto);
  });

  it("passes the acting admin id when creating a club account", async () => {
    clubAccounts.create.mockResolvedValue({ id: "u2" });
    const dto = { email: "c@test.com" } as CreateClubAccountDto;
    await controller.createClubAccount(dto, req);
    expect(clubAccounts.create).toHaveBeenCalledWith("admin-1", dto);
  });

  it("passes the acting admin id when resending an invitation", async () => {
    clubAccounts.resendInvitation.mockResolvedValue({ sent: true });
    await controller.resendInvitation("u1", req);
    expect(clubAccounts.resendInvitation).toHaveBeenCalledWith("admin-1", "u1");
  });
});
