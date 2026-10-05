import { UnauthorizedException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { AuthController } from "./auth.controller";
import { AuthPasswordService } from "./auth-password.service";
import { AuthService } from "./auth.service";
import { AuthTokenService } from "./auth-token.service";

describe("AuthController", () => {
  let controller: AuthController;
  let authService: AuthService;
  let authTokenService: AuthTokenService;
  let authPasswordService: AuthPasswordService;

  const mockAuthService = {
    login: jest.fn(),
    validateUser: jest.fn(),
  };

  const mockAuthTokenService = {
    refreshAccessToken: jest.fn(),
    revokeRefreshToken: jest.fn(),
  };

  const mockAuthPasswordService = {
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    changePassword: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: AuthTokenService, useValue: mockAuthTokenService },
        { provide: AuthPasswordService, useValue: mockAuthPasswordService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
    authTokenService = module.get<AuthTokenService>(AuthTokenService);
    authPasswordService = module.get<AuthPasswordService>(AuthPasswordService);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("login", () => {
    it("should return token if validation succeeds", async () => {
      const mockReq = { username: "user", password: "pwd" };
      const mockUser = { id: "u1" };
      const mockResult = { access_token: "token" };

      mockAuthService.validateUser.mockResolvedValue(mockUser);
      mockAuthService.login.mockResolvedValue(mockResult);

      const result = await controller.login(mockReq);

      expect(authService.validateUser).toHaveBeenCalledWith("user", "pwd");
      expect(authService.login).toHaveBeenCalledWith(mockUser);
      expect(result).toBe(mockResult);
    });

    it("should throw UnauthorizedException if validation fails", async () => {
      const mockReq = { username: "user", password: "pwd" };
      mockAuthService.validateUser.mockResolvedValue(null);

      await expect(controller.login(mockReq)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe("refresh", () => {
    it("should return new tokens", async () => {
      const mockResult = { access_token: "new", refresh_token: "new-ref" };
      mockAuthTokenService.refreshAccessToken.mockResolvedValue(mockResult);

      const result = await controller.refresh({
        refresh_token: "old-token",
      });
      expect(result).toBe(mockResult);
      expect(authTokenService.refreshAccessToken).toHaveBeenCalledWith(
        "old-token",
      );
    });
  });

  describe("logout", () => {
    it("should return success when token revoked", async () => {
      mockAuthTokenService.revokeRefreshToken.mockResolvedValue(true);

      const result = await controller.logout({ refresh_token: "tok" });
      expect(result).toEqual({
        success: true,
        message: "Logged out successfully",
      });
    });

    it("should throw when token invalid", async () => {
      mockAuthTokenService.revokeRefreshToken.mockResolvedValue(false);
      await expect(controller.logout({ refresh_token: "bad" })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe("forgotPassword", () => {
    it("should call service", async () => {
      mockAuthPasswordService.forgotPassword.mockResolvedValue({
        success: true,
      });
      const result = await controller.forgotPassword({ email: "u@test.com" });
      expect(result).toEqual({ success: true });
      expect(authPasswordService.forgotPassword).toHaveBeenCalledWith(
        "u@test.com",
      );
    });
  });

  describe("resetPassword", () => {
    it("should call service", async () => {
      mockAuthPasswordService.resetPassword.mockResolvedValue({
        success: true,
      });
      const result = await controller.resetPassword({
        token: "t",
        newPassword: "ValidPass1!",
      });
      expect(result).toEqual({ success: true });
      expect(authPasswordService.resetPassword).toHaveBeenCalledWith(
        "t",
        "ValidPass1!",
      );
    });
  });

  describe("changePassword", () => {
    it("should call service with user id", async () => {
      mockAuthPasswordService.changePassword.mockResolvedValue({
        success: true,
      });
      const req = { user: { userId: "u1" } } as never;
      const result = await controller.changePassword(req, {
        currentPassword: "Old1!",
        newPassword: "NewValid1!",
      });
      expect(result).toEqual({ success: true });
      expect(authPasswordService.changePassword).toHaveBeenCalledWith(
        "u1",
        "Old1!",
        "NewValid1!",
      );
    });
  });
});
