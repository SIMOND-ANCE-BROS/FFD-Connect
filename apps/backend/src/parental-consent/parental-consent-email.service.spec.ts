import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import {
  PARENTAL_CONSENT_EMAIL_TIMEOUT_MS,
  ParentalConsentEmailService,
  parentalConsentEmailTemplate,
} from "./parental-consent-email.service";

const mockSend = jest.fn();
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

function config(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("ParentalConsentEmailService (#61)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("builds the landing-page link with the token in the query string", () => {
    const service = new ParentalConsentEmailService(
      config({ FRONTEND_URL: "https://ffd.example.fr/" }),
      new CircuitBreakerService(),
    );
    expect(service.consentUrl("abc")).toBe(
      "https://ffd.example.fr/consentement-parental/?token=abc",
    );
  });

  it("falls back to a local URL without FRONTEND_URL", () => {
    const service = new ParentalConsentEmailService(
      config({}),
      new CircuitBreakerService(),
    );
    expect(service.consentUrl("abc")).toBe(
      "http://localhost:3000/consentement-parental/?token=abc",
    );
  });

  it("sends nothing (and logs no link) without Resend", async () => {
    const service = new ParentalConsentEmailService(
      config({}),
      new CircuitBreakerService(),
    );
    await expect(
      service.sendConsentRequest("p@example.com", "Léa", "tok"),
    ).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });

  describe("with Resend", () => {
    let breaker: CircuitBreakerService;
    let service: ParentalConsentEmailService;

    beforeEach(() => {
      breaker = new CircuitBreakerService();
      service = new ParentalConsentEmailService(
        config({
          RESEND_API_KEY: "re_test",
          RESEND_FROM_EMAIL: "no-reply@ffd.example.fr",
          FRONTEND_URL: "https://ffd.example.fr",
        }),
        breaker,
      );
    });

    it("sends through the email breaker, with a timeout", async () => {
      mockSend.mockResolvedValue({ data: { id: "m1" }, error: null });
      const fire = jest.spyOn(breaker, "fire");

      await service.sendConsentRequest("p@example.com", "Léa", "tok123");

      expect(fire).toHaveBeenCalledWith("email", expect.any(Function));
      const message = mockSend.mock.calls[0][0];
      expect(message.from).toBe("no-reply@ffd.example.fr");
      expect(message.to).toBe("p@example.com");
      expect(message.html).toContain(
        "https://ffd.example.fr/consentement-parental/?token=tok123",
      );
      expect(message.html).toContain("Léa");
      expect(PARENTAL_CONSENT_EMAIL_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it("defaults the sender when none is configured", async () => {
      service = new ParentalConsentEmailService(
        config({ RESEND_API_KEY: "re_test" }),
        breaker,
      );
      mockSend.mockResolvedValue({ data: { id: "m1" }, error: null });
      await service.sendConsentRequest("p@example.com", "Léa", "t");
      expect(mockSend.mock.calls[0][0].from).toBe("onboarding@resend.dev");
    });

    it("throws when Resend reports an error", async () => {
      mockSend.mockResolvedValue({ data: null, error: { message: "quota" } });
      await expect(
        service.sendConsentRequest("p@example.com", "Léa", "t"),
      ).rejects.toThrow("Failed to send email: quota");
    });

    it("degrades to 503 once the breaker is open", async () => {
      jest
        .spyOn(breaker, "fire")
        .mockRejectedValue(new ServiceUnavailableException("open"));
      await expect(
        service.sendConsentRequest("p@example.com", "Léa", "t"),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe("template", () => {
    it("neutralises HTML in the child's first name", () => {
      const html = parentalConsentEmailTemplate(
        "https://x/?token=1",
        "<script>Léa",
      );
      expect(html).not.toContain("<script>");
      expect(html).toContain("scriptLéa");
    });

    it("falls back to a neutral wording without a usable first name", () => {
      const html = parentalConsentEmailTemplate("https://x/?token=1", "<>");
      expect(html).toContain("Votre enfant vient de créer un compte");
    });

    it("tells the parent the link also withdraws the consent", () => {
      const html = parentalConsentEmailTemplate("https://x/?token=1", "Léa");
      expect(html).toContain("retirer votre accord à tout moment");
      expect(html).toContain("7 jours");
    });
  });
});
