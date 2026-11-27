import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NoImpersonationGuard } from "../auth/no-impersonation.guard";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import { PaginationParamsDto } from "../common/dto/pagination-params.dto";
import { ClubMembersPageDto } from "./dto/club-members-page.dto";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

describe("UsersController", () => {
  let controller: UsersController;
  let service: jest.Mocked<UsersService>;

  const mockUsersService = {
    findClubMembers: jest.fn(),
    findOne: jest.fn(),
    updateWdsf: jest.fn(),
    exportMyData: jest.fn(),
    deleteMyAccount: jest.fn(),
    searchUsers: jest.fn(),
  };

  const req = (userId: string, role = "LICENSEE") =>
    ({
      user: { userId, role, email: `${userId}@test.com` },
    }) as any as RequestWithUser;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerUserGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
    service = module.get(UsersService);
    jest.clearAllMocks();
  });

  describe("getProfile", () => {
    it("calls service.findOne with userId from req.user and returns the result", async () => {
      const profile = { id: "user-id", firstName: "Alice", lastName: "B" };
      service.findOne.mockResolvedValue(profile as any);

      const result = await controller.getProfile(req("user-id"));

      expect(service.findOne).toHaveBeenCalledWith("user-id", {
        supportAccess: false,
      });
      expect(result).toBe(profile);
    });

    it("flags a support access so the static QR is withheld (#759)", async () => {
      service.findOne.mockResolvedValue({} as never);
      const impersonated = {
        user: { userId: "user-id", email: "u@test.com", impersonatedBy: "a-1" },
      } as unknown as RequestWithUser;

      await controller.getProfile(impersonated);

      expect(service.findOne).toHaveBeenCalledWith("user-id", {
        supportAccess: true,
      });
    });

    it("propagates NotFoundException when user does not exist", async () => {
      service.findOne.mockRejectedValue(
        new NotFoundException("User not found"),
      );

      await expect(controller.getProfile(req("missing"))).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("updateProfile", () => {
    it("calls service.updateWdsf with userId and wdsf payload, returns updated user", async () => {
      const wdsf = {
        min: "12345",
        nationality: "FRA",
        licenseType: "AMATEUR",
        ageGroup: "ADULT",
        expiresOn: "2027-01-01",
      };
      const updated = { id: "user-id", wdsfMin: "12345" };
      service.updateWdsf.mockResolvedValue(updated as any);

      const result = await controller.updateProfile(req("user-id"), {
        wdsf,
      });

      expect(service.updateWdsf).toHaveBeenCalledWith("user-id", wdsf);
      expect(result).toBe(updated);
    });

    it("passes null to service.updateWdsf when wdsf is absent (dissociation)", async () => {
      const updated = { id: "user-id", wdsfMin: null };
      service.updateWdsf.mockResolvedValue(updated as any);

      await controller.updateProfile(req("user-id"), {});

      expect(service.updateWdsf).toHaveBeenCalledWith("user-id", null);
    });

    it("propagates NotFoundException when user does not exist", async () => {
      service.updateWdsf.mockRejectedValue(new NotFoundException());

      await expect(
        controller.updateProfile(req("missing"), {} as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getMembers", () => {
    it("documents its 200 answer as a page ({ data, meta }), not a list (#953)", () => {
      // Metadata key of @ApiResponse (@nestjs/swagger DECORATORS.API_RESPONSE).
      const responses = Reflect.getMetadata(
        "swagger/apiResponse",
        UsersController.prototype.getMembers,
      ) as Record<string, { type?: unknown; schema?: unknown }>;

      expect(responses["200"].type).toBe(ClubMembersPageDto);
      expect(responses["200"].schema).toBeUndefined();
    });

    it("calls service.findClubMembers with userId from req.user and pagination params", async () => {
      const members = {
        data: [{ id: "1", name: "Member 1" }],
        meta: { total: 1, skip: 0, take: 10, hasMore: false },
      };
      service.findClubMembers.mockResolvedValue(members as any);
      const pagination: PaginationParamsDto = { skip: 0, take: 10 };

      const result = await controller.getMembers(
        req("user-id", "CLUB"),
        pagination,
      );

      expect(service.findClubMembers).toHaveBeenCalledWith(
        "user-id",
        pagination,
      );
      expect(result).toBe(members);
    });

    it("forwards pagination offset and limit faithfully", async () => {
      service.findClubMembers.mockResolvedValue({ data: [], meta: {} } as any);
      const pagination: PaginationParamsDto = { skip: 20, take: 5 };

      await controller.getMembers(req("club-user"), pagination);

      expect(service.findClubMembers).toHaveBeenCalledWith(
        "club-user",
        pagination,
      );
    });

    it("propagates NotFoundException when organizer has no club assigned", async () => {
      service.findClubMembers.mockRejectedValue(
        new NotFoundException("Organizer has no club assigned"),
      );

      await expect(
        controller.getMembers(req("user-id"), { skip: 0, take: 10 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("exportMyData (RGPD art. 20)", () => {
    it("delegates to service with the authenticated userId", async () => {
      const payload = {
        format: "ffd-connect-export-v1",
        exportedAt: "2026-07-06T00:00:00.000Z",
        data: { id: "user-id" },
      };
      service.exportMyData.mockResolvedValue(payload as any);

      const result = await controller.exportMyData(req("user-id"));

      expect(service.exportMyData).toHaveBeenCalledWith("user-id");
      expect(result).toBe(payload);
    });
  });

  describe("deleteMyAccount (RGPD art. 17)", () => {
    it("delegates to service with userId + password and confirms", async () => {
      service.deleteMyAccount.mockResolvedValue(undefined);

      const result = await controller.deleteMyAccount(req("user-id"), {
        password: "s3cret",
      });

      expect(service.deleteMyAccount).toHaveBeenCalledWith("user-id", "s3cret");
      expect(result).toEqual({ message: "Compte supprimé" });
    });

    // #1041: the password check must not be brute-forceable with a stolen
    // access token — same per-account limit as change-password (#633).
    it("is refused from inside a session and throttled per account (5/min)", () => {
      const handler = UsersController.prototype.deleteMyAccount;
      const guards = Reflect.getMetadata("__guards__", handler) as unknown[];
      // JwtAuthGuard first: it fills req.user, the throttler's key.
      expect(guards).toEqual([
        JwtAuthGuard,
        NoImpersonationGuard,
        ThrottlerUserGuard,
      ]);
      expect(Reflect.getMetadata("THROTTLER:LIMITdefault", handler)).toBe(5);
      expect(Reflect.getMetadata("THROTTLER:TTLdefault", handler)).toBe(60000);
    });

    it("propagates the service error (ex. mauvais mot de passe)", async () => {
      service.deleteMyAccount.mockRejectedValue(new Error("Unauthorized"));

      await expect(
        controller.deleteMyAccount(req("user-id"), { password: "bad" }),
      ).rejects.toThrow("Unauthorized");
    });
  });

  describe("searchUsers (#545)", () => {
    it("délègue la recherche au service", () => {
      const results = [{ id: "u1", email: "a@b.c" }];
      service.searchUsers.mockReturnValue(results as never);

      const res = controller.searchUsers("dupont");

      expect(service.searchUsers).toHaveBeenCalledWith("dupont");
      expect(res).toBe(results);
    });

    it("gère une query absente", () => {
      service.searchUsers.mockReturnValue([] as never);
      const res = controller.searchUsers(undefined);
      expect(res).toBeDefined();
      expect(service.searchUsers).toHaveBeenCalledWith("");
    });
  });
});
