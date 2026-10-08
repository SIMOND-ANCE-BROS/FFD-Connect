import { GUARDS_METADATA } from "@nestjs/common/constants";
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { RolesGuard } from "../auth/guards/roles.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AdminAuditService } from "./admin-audit.service";
import { AdminClubsQueryService } from "./admin-clubs.query-service";
import { AdminClubsService } from "./admin-clubs.service";
import { AdminReferenceService } from "./admin-reference.service";
import { AdminUserAccountsService } from "./admin-user-accounts.service";
import { AdminUsersQueryService } from "./admin-users.query-service";
import { AdminUsersService } from "./admin-users.service";
import { AdminController } from "./admin.controller";
import type { CreateAdminUserDto } from "./dto/admin-user-accounts.dto";
import type { UpdateAdminUserDto } from "./dto/update-admin-user.dto";

describe("AdminController", () => {
  const audit = { list: jest.fn() };
  const reference = { referenceData: jest.fn() };
  const usersQuery = { list: jest.fn(), detail: jest.fn() };
  const users = { update: jest.fn(), setStatus: jest.fn(), delete: jest.fn() };
  const userAccounts = { create: jest.fn(), resendInvitation: jest.fn() };
  const clubsQuery = { list: jest.fn(), options: jest.fn(), detail: jest.fn() };
  const clubs = { update: jest.fn(), setStatus: jest.fn(), delete: jest.fn() };

  const controller = new AdminController(
    audit as unknown as AdminAuditService,
    reference,
    usersQuery as unknown as AdminUsersQueryService,
    users as unknown as AdminUsersService,
    userAccounts as unknown as AdminUserAccountsService,
    clubsQuery as unknown as AdminClubsQueryService,
    clubs as unknown as AdminClubsService,
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

  it("delegates the clubs list", async () => {
    clubsQuery.list.mockResolvedValue({ data: [] });
    const query = { skip: 0, take: 10 };
    await controller.listClubs(query);
    expect(clubsQuery.list).toHaveBeenCalledWith(query);
  });

  it("passes the selected club through to the options", async () => {
    clubsQuery.options.mockResolvedValue([{ id: "c1", name: "Club" }]);
    await expect(controller.clubOptions({ includeId: "c1" })).resolves.toEqual([
      { id: "c1", name: "Club" },
    ]);
    expect(clubsQuery.options).toHaveBeenCalledWith("c1");
  });

  it("delegates the club detail", async () => {
    clubsQuery.detail.mockResolvedValue({ id: "c1" });
    await expect(controller.getClub("c1")).resolves.toEqual({ id: "c1" });
  });

  it("passes the acting admin id to every club write", async () => {
    await controller.updateClub("c1", { name: "Club Z" }, req);
    expect(clubs.update).toHaveBeenCalledWith("admin-1", "c1", {
      name: "Club Z",
    });
    await controller.setClubStatus("c1", { active: false }, req);
    expect(clubs.setStatus).toHaveBeenCalledWith("admin-1", "c1", false);
    await controller.deleteClub("c1", req);
    expect(clubs.delete).toHaveBeenCalledWith("admin-1", "c1");
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

  it("passes the acting admin id when changing a user's status", async () => {
    users.setStatus.mockResolvedValue({ id: "u1" });
    await controller.setUserStatus("u1", { active: false }, req);
    expect(users.setStatus).toHaveBeenCalledWith("admin-1", "u1", false);
  });

  it("passes the acting admin id when creating a user", async () => {
    userAccounts.create.mockResolvedValue({ userId: "u2" });
    const dto = { email: "c@test.com", role: "CLUB" } as CreateAdminUserDto;
    await controller.createUser(dto, req);
    expect(userAccounts.create).toHaveBeenCalledWith("admin-1", dto);
  });

  it("passes the acting admin id when resending an invitation", async () => {
    userAccounts.resendInvitation.mockResolvedValue({ invitationSent: true });
    await controller.resendInvitation("u1", req);
    expect(userAccounts.resendInvitation).toHaveBeenCalledWith("admin-1", "u1");
  });

  it("passes the acting admin id and the typed email when deleting a user", async () => {
    users.delete.mockResolvedValue(undefined);
    await controller.deleteUser("u1", { confirmEmail: "j@x.fr" }, req);
    expect(users.delete).toHaveBeenCalledWith("admin-1", "u1", "j@x.fr");
  });
});
