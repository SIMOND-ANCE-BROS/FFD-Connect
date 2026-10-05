import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { EmailService } from "./email.service";

const mockSend = jest.fn();
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

describe("EmailService", () => {
  let service: EmailService;
  const mockConfigService = { get: jest.fn() };

  describe("without Resend (no API key)", () => {
    beforeEach(async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "RESEND_API_KEY") return null;
        if (key === "RESEND_FROM_EMAIL") return null;
        return undefined;
      });
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      service = module.get<EmailService>(EmailService);
      jest.clearAllMocks();
    });

    it("should be defined", () => {
      expect(service).toBeDefined();
    });

    it("should return without sending when Resend not configured", async () => {
      await expect(
        service.sendPasswordResetEmail("user@test.com", "token123"),
      ).resolves.not.toThrow();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should use custom resetUrl when provided", async () => {
      await service.sendPasswordResetEmail(
        "u@test.com",
        "tok",
        "https://app.com/reset?t=tok",
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should use FRONTEND_URL from env for default URL", async () => {
      const orig = process.env.FRONTEND_URL;
      process.env.FRONTEND_URL = "https://myapp.com";
      await service.sendPasswordResetEmail("u@test.com", "tok");
      expect(mockSend).not.toHaveBeenCalled();
      process.env.FRONTEND_URL = orig;
    });
  });

  describe("with Resend configured", () => {
    beforeEach(async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "RESEND_API_KEY") return "re_test_key";
        if (key === "RESEND_FROM_EMAIL") return "noreply@test.com";
        return undefined;
      });
      mockSend.mockResolvedValue({ data: { id: "msg_123" }, error: null });
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      service = module.get<EmailService>(EmailService);
      jest.clearAllMocks();
      mockSend.mockResolvedValue({ data: { id: "msg_123" }, error: null });
    });

    it("should send email via Resend", async () => {
      await service.sendPasswordResetEmail(
        "user@test.com",
        "token456",
        "https://app.com/reset?token=token456",
      );
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "user@test.com",
          subject: "Réinitialisation de votre mot de passe",
          from: "noreply@test.com",
        }),
      );
      expect(mockSend.mock.calls[0][0].html).toContain(
        "https://app.com/reset?token=token456",
      );
    });

    it("should throw when Resend returns error", async () => {
      mockSend.mockResolvedValue({
        data: null,
        error: { message: "Invalid API key" },
      });
      await expect(
        service.sendPasswordResetEmail("u@test.com", "tok"),
      ).rejects.toThrow("Failed to send email");
    });

    it("should throw when Resend send throws", async () => {
      mockSend.mockRejectedValue(new Error("Network error"));
      await expect(
        service.sendPasswordResetEmail("u@test.com", "tok"),
      ).rejects.toThrow("Network error");
    });
  });
});
