import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import {
  EMAIL_SEND_TIMEOUT_MS,
  EmailSendError,
  EmailService,
} from "./email.service";

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
          CircuitBreakerService,
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

  describe("sendInvitationEmail without Resend", () => {
    beforeEach(async () => {
      mockConfigService.get.mockReturnValue(undefined);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: mockConfigService },
          CircuitBreakerService,
        ],
      }).compile();
      service = module.get<EmailService>(EmailService);
      jest.clearAllMocks();
    });

    it("skips the email-changed notice when Resend is not configured", async () => {
      await expect(
        service.sendEmailChangedNotice("old@x.fr", "Jo"),
      ).resolves.toBeUndefined();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("only logs when Resend is not configured", async () => {
      await expect(
        service.sendInvitationEmail("c@x.fr", "tok", "Jo", "CLUB"),
      ).resolves.toBeUndefined();
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("with Resend configured", () => {
    beforeEach(async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "RESEND_API_KEY") return "re_test_key";
        if (key === "RESEND_FROM_EMAIL") return "noreply@test.com";
        if (key === "FRONTEND_URL") return "https://ffd.gabin-simond.fr";
        return undefined;
      });
      mockSend.mockResolvedValue({ data: { id: "msg_123" }, error: null });
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: mockConfigService },
          CircuitBreakerService,
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

    it("sends the email-changed notice to the previous address, without the new one", async () => {
      await service.sendEmailChangedNotice("old@x.fr", "<Jo>");
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "old@x.fr",
          from: "noreply@test.com",
          subject: "L'email de votre compte FFD Connect a été modifié",
        }),
      );
      const html = mockSend.mock.calls[0][0].html as string;
      expect(html).toContain("Bonjour Jo,");
      expect(html).not.toContain("<Jo>");
      expect(html).not.toContain("href");
    });

    it("throws when Resend refuses the email-changed notice", async () => {
      mockSend.mockResolvedValue({ data: null, error: { message: "boom" } });
      await expect(
        service.sendEmailChangedNotice("old@x.fr", "Jo"),
      ).rejects.toThrow("Failed to send email: boom");
    });

    it("bounds the email-changed notice with a timeout", async () => {
      jest.useFakeTimers();
      try {
        mockSend.mockReturnValue(new Promise(() => undefined));
        const sent = service.sendEmailChangedNotice("old@x.fr", "Jo");
        const assertion = expect(sent).rejects.toThrow(/timed out/);
        await jest.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS + 1);
        await assertion;
      } finally {
        jest.useRealTimers();
      }
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

    // #464: every Resend call goes through the `email` breaker + withTimeout.
    describe.each([
      [
        "password reset",
        (svc: EmailService) => svc.sendPasswordResetEmail("u@test.com", "tok"),
      ],
      [
        "invitation",
        (svc: EmailService) =>
          svc.sendInvitationEmail("c@x.fr", "tok", "Jo", "CLUB"),
      ],
      [
        "email-changed notice",
        (svc: EmailService) => svc.sendEmailChangedNotice("old@x.fr", "Jo"),
      ],
    ])("%s through the email circuit breaker", (_name, sendOne) => {
      it("is bounded by the send timeout", async () => {
        jest.useFakeTimers();
        try {
          mockSend.mockReturnValue(new Promise(() => undefined));
          const sent = sendOne(service);
          const assertion = expect(sent).rejects.toThrow(/timed out/);
          await jest.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS + 1);
          await assertion;
        } finally {
          jest.useRealTimers();
        }
      });

      it("fails fast without calling Resend once the breaker is open", async () => {
        mockSend.mockResolvedValue({
          data: null,
          error: {
            message: "down",
            statusCode: 500,
            name: "internal_server_error",
          },
        });
        for (let i = 0; i < 6; i++) {
          await sendOne(service).catch(() => undefined);
        }
        mockSend.mockClear();

        await expect(sendOne(service)).rejects.toBeInstanceOf(
          ServiceUnavailableException,
        );
        expect(mockSend).not.toHaveBeenCalled();
      });

      it("does not open the breaker on refused messages (4xx, #437)", async () => {
        mockSend.mockResolvedValue({
          data: null,
          error: {
            message: "bad to",
            statusCode: 422,
            name: "validation_error",
          },
        });
        for (let i = 0; i < 10; i++) {
          await expect(sendOne(service)).rejects.toBeInstanceOf(EmailSendError);
        }
        mockSend.mockResolvedValue({ data: { id: "m" }, error: null });

        await expect(sendOne(service)).resolves.toBeUndefined();
      });
    });

    describe("sendInvitationEmail", () => {
      it("sends a club invitation whose link opens the web reset page with the token", async () => {
        await service.sendInvitationEmail(
          "club@example.fr",
          "tok123",
          "Jeanne",
          "CLUB",
        );

        const arg = mockSend.mock.calls[0][0];
        expect(arg.to).toBe("club@example.fr");
        expect(arg.subject).toBe("Votre accès club FFD Connect");
        expect(arg.html).toContain(
          "https://ffd.gabin-simond.fr/reset-password?token=tok123",
        );
        expect(arg.html).toContain("Bonjour Jeanne");
        expect(arg.html).toContain("7 jours");
      });

      it.each([
        ["LICENSEE", "Votre compte FFD Connect", "Un compte licencié"],
        ["CLUB", "Votre accès club FFD Connect", "Un compte club"],
        ["STAFF", "Votre accès staff FFD Connect", "Un compte staff"],
      ] as const)(
        "words the %s invitation for that role",
        async (role, subject, intro) => {
          await service.sendInvitationEmail("a@x.fr", "t", "Jo", role);
          const arg = mockSend.mock.calls[0][0];
          expect(arg.subject).toBe(subject);
          expect(arg.html).toContain(intro);
        },
      );

      it("strips HTML from the first name", async () => {
        await service.sendInvitationEmail("c@x.fr", "t", "<b>Jo</b>", "CLUB");
        expect(mockSend.mock.calls[0][0].html).toContain("Bonjour bJo/b");
      });

      it("throws when the provider returns an error", async () => {
        mockSend.mockResolvedValue({ data: null, error: { message: "boom" } });
        await expect(
          service.sendInvitationEmail(
            "club@example.fr",
            "tok123",
            "Jeanne",
            "LICENSEE",
          ),
        ).rejects.toThrow("Failed to send email: boom");
      });
    });
  });

  // RGPD (#527): the recipient address never reaches the logs, only a masked form.
  describe("log lines never contain the recipient address", () => {
    const ADDRESS = "jeanne.martin@club-exemple.fr";
    let logged: string[];
    let spies: jest.SpyInstance[];

    const buildService = async (apiKey: string | null) => {
      mockConfigService.get.mockImplementation((key: string) =>
        key === "RESEND_API_KEY" ? apiKey : undefined,
      );
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: mockConfigService },
          CircuitBreakerService,
        ],
      }).compile();
      return module.get<EmailService>(EmailService);
    };

    beforeEach(() => {
      jest.clearAllMocks();
      logged = [];
      const capture = (...args: unknown[]) => {
        logged.push(
          args
            .map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : a))
            .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
            .join(" "),
        );
      };
      spies = (["log", "warn", "error", "debug", "verbose"] as const).map(
        (level) =>
          jest.spyOn(Logger.prototype, level).mockImplementation(capture),
      );
    });

    afterEach(() => spies.forEach((spy) => spy.mockRestore()));

    const expectNoAddress = () => {
      expect(logged.length).toBeGreaterThan(0);
      for (const line of logged) {
        expect(line).not.toContain(ADDRESS);
        expect(line).not.toContain("jeanne.martin");
        expect(line).not.toContain("club-exemple");
      }
    };

    it("password reset without Resend logs a masked address", async () => {
      const svc = await buildService(null);
      await svc.sendPasswordResetEmail(ADDRESS, "tok");
      expectNoAddress();
      expect(logged.join("\n")).toContain("j***@c***.fr");
    });

    it("password reset sent through Resend", async () => {
      const svc = await buildService("re_key");
      mockSend.mockResolvedValue({ data: { id: "msg_1" }, error: null });
      await svc.sendPasswordResetEmail(ADDRESS, "tok");
      expectNoAddress();
      expect(logged.join("\n")).toContain("msg_1");
    });

    it("password reset refused by Resend", async () => {
      const svc = await buildService("re_key");
      mockSend.mockResolvedValue({ data: null, error: { message: "boom" } });
      await expect(
        svc.sendPasswordResetEmail(ADDRESS, "tok"),
      ).rejects.toThrow();
      expectNoAddress();
    });

    it("password reset failing with a network error", async () => {
      const svc = await buildService("re_key");
      mockSend.mockRejectedValue(new Error("Network error"));
      await expect(
        svc.sendPasswordResetEmail(ADDRESS, "tok"),
      ).rejects.toThrow();
      expectNoAddress();
    });

    it("invitation without Resend", async () => {
      const svc = await buildService(null);
      await svc.sendInvitationEmail(ADDRESS, "tok", "Jeanne", "CLUB");
      expectNoAddress();
    });

    it("invitation sent through Resend", async () => {
      const svc = await buildService("re_key");
      mockSend.mockResolvedValue({ data: { id: "msg_2" }, error: null });
      await svc.sendInvitationEmail(ADDRESS, "tok", "Jeanne", "LICENSEE");
      expectNoAddress();
      expect(logged.join("\n")).toContain("msg_2");
    });

    it("invitation refused by Resend", async () => {
      const svc = await buildService("re_key");
      mockSend.mockResolvedValue({ data: null, error: { message: "boom" } });
      await expect(
        svc.sendInvitationEmail(ADDRESS, "tok", "Jeanne", "STAFF"),
      ).rejects.toThrow();
      expectNoAddress();
    });

    it("email-changed notice without Resend", async () => {
      const svc = await buildService(null);
      await svc.sendEmailChangedNotice(ADDRESS, "Jeanne");
      expectNoAddress();
    });
  });
});
