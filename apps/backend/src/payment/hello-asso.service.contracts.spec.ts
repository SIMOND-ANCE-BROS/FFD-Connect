import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import nock from "nock";
import type { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { HelloAssoService } from "./hello-asso.service";

const HELLOASSO_API = "https://api.helloasso.com";

const credentials = {
  clientId: "client-id",
  clientSecret: "client-secret",
  organizationSlug: "org-slug",
};

const checkoutParams = {
  amount: 1500,
  label: "Place Compétition - A1",
  consumerEmail: "user@example.com",
  consumerFirstName: "John",
  consumerLastName: "Doe",
  metadata: { bookingId: "booking-1", competitionId: "comp-1" },
};

/** Passthrough circuit breaker that just executes the function */
const mockCircuitBreaker = {
  fire: jest.fn().mockImplementation((_key: string, fn: () => unknown) => fn()),
} as unknown as CircuitBreakerService;

describe("HelloAssoService — contrats HTTP", () => {
  let service: HelloAssoService;

  beforeEach(() => {
    nock.cleanAll();
    service = new HelloAssoService(mockCircuitBreaker, {
      get: jest.fn(),
    } as unknown as ConfigService);
    // Reset token cache between tests
    // @ts-expect-error accessing private field for test reset
    service["tokenCache"].clear();
  });

  afterAll(() => {
    nock.cleanAll();
  });

  describe("createCheckoutIntent — succès", () => {
    it("obtient un token OAuth puis crée le checkout intent", async () => {
      nock(HELLOASSO_API)
        .post("/oauth2/token")
        .reply(200, { access_token: "tok-abc", expires_in: 3600 });

      nock(HELLOASSO_API)
        .post("/v5/organizations/org-slug/checkout-intents")
        .reply(200, {
          id: "intent-1",
          redirectUrl: "https://www.helloasso.com/checkout/intent-1",
        });

      const result = await service.createCheckoutIntent(
        credentials,
        "https://app.example.com",
        checkoutParams,
      );

      expect(result.id).toBe("intent-1");
      expect(result.redirectUrl).toContain("intent-1");
    });

    it("réutilise le token en cache sans rappeler /oauth2/token", async () => {
      // First call: fresh token
      nock(HELLOASSO_API)
        .post("/oauth2/token")
        .reply(200, { access_token: "tok-cached", expires_in: 3600 });
      nock(HELLOASSO_API)
        .post("/v5/organizations/org-slug/checkout-intents")
        .reply(200, { id: "intent-1", redirectUrl: "https://helloasso.com/1" });

      await service.createCheckoutIntent(
        credentials,
        "https://app.example.com",
        checkoutParams,
      );

      // Second call: no new nock for token — nock would throw if token endpoint is called again
      nock(HELLOASSO_API)
        .post("/v5/organizations/org-slug/checkout-intents")
        .reply(200, { id: "intent-2", redirectUrl: "https://helloasso.com/2" });

      const result = await service.createCheckoutIntent(
        credentials,
        "https://app.example.com",
        checkoutParams,
      );

      expect(result.id).toBe("intent-2");
    });
  });

  describe("createCheckoutIntent — erreurs", () => {
    it("propage l'erreur quand /oauth2/token retourne 401", async () => {
      nock(HELLOASSO_API)
        .post("/oauth2/token")
        .reply(401, { error: "invalid_client" });

      await expect(
        service.createCheckoutIntent(
          credentials,
          "https://app.example.com",
          checkoutParams,
        ),
      ).rejects.toThrow();
    });

    it("propage l'erreur quand /checkout-intents retourne 500", async () => {
      nock(HELLOASSO_API)
        .post("/oauth2/token")
        .reply(200, { access_token: "tok-abc", expires_in: 3600 });

      nock(HELLOASSO_API)
        .post("/v5/organizations/org-slug/checkout-intents")
        .reply(500, { message: "Internal Server Error" });

      await expect(
        service.createCheckoutIntent(
          credentials,
          "https://app.example.com",
          checkoutParams,
        ),
      ).rejects.toThrow();
    });

    it("propage l'erreur réseau (ECONNREFUSED)", async () => {
      nock(HELLOASSO_API)
        .post("/oauth2/token")
        .reply(200, { access_token: "tok-abc", expires_in: 3600 });

      nock(HELLOASSO_API)
        .post("/v5/organizations/org-slug/checkout-intents")
        .replyWithError("connect ECONNREFUSED 127.0.0.1:443");

      await expect(
        service.createCheckoutIntent(
          credentials,
          "https://app.example.com",
          checkoutParams,
        ),
      ).rejects.toThrow();
    });
  });
  describe("hôte de l'API (#404)", () => {
    it("vise le sandbox quand HELLOASSO_API_URL le désigne", async () => {
      const sandbox = new HelloAssoService(mockCircuitBreaker, {
        get: jest.fn().mockReturnValue("https://api.helloasso-sandbox.com"),
      } as unknown as ConfigService);
      nock("https://api.helloasso-sandbox.com")
        .post("/oauth2/token")
        .reply(200, { access_token: "tok-sbx", expires_in: 1800 });
      nock("https://api.helloasso-sandbox.com")
        .post("/v5/organizations/org-slug/checkout-intents")
        .reply(200, { id: 42, redirectUrl: "https://sandbox/42" });

      const result = await sandbox.createCheckoutIntent(
        credentials,
        "https://app.example.com",
        checkoutParams,
      );

      expect(result.id).toBe(42);
      expect(nock.isDone()).toBe(true);
    });

    it("encode le slug de l'organisation dans l'URL", async () => {
      nock(HELLOASSO_API)
        .post("/oauth2/token")
        .reply(200, { access_token: "tok", expires_in: 3600 });
      nock(HELLOASSO_API)
        .post("/v5/organizations/a%2F..%2Fb/checkout-intents")
        .reply(200, { id: 1, redirectUrl: "https://x" });

      await service.createCheckoutIntent(
        { ...credentials, organizationSlug: "a/../b" },
        "https://app.example.com",
        checkoutParams,
      );

      expect(nock.isDone()).toBe(true);
    });

    it("ne journalise jamais le secret du club quand le jeton est refusé", async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);
      nock(HELLOASSO_API)
        .post("/oauth2/token")
        .reply(401, { error: "invalid_client" });

      await expect(
        service.createCheckoutIntent(
          credentials,
          "https://app.example.com",
          checkoutParams,
        ),
      ).rejects.toThrow();

      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).toContain("401");
      expect(logged).not.toContain(credentials.clientSecret);
      errorSpy.mockRestore();
    });
  });

  it("ne réutilise pas le jeton d'un club pour un autre secret sur le même clientId", async () => {
    nock(HELLOASSO_API)
      .post("/oauth2/token")
      .reply(200, { access_token: "tok-victim", expires_in: 3600 });
    nock(HELLOASSO_API)
      .post("/v5/organizations/org-slug/checkout-intents")
      .reply(200, { id: 1, redirectUrl: "https://x" });
    await service.createCheckoutIntent(
      credentials,
      "https://app.example.com",
      checkoutParams,
    );

    // Same clientId, wrong secret: HelloAsso must be asked (and refuses).
    nock(HELLOASSO_API)
      .post("/oauth2/token")
      .reply(401, { error: "invalid_client" });
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    await expect(
      service.createCheckoutIntent(
        { ...credentials, clientSecret: "guess" },
        "https://app.example.com",
        checkoutParams,
      ),
    ).rejects.toThrow();
    errorSpy.mockRestore();
    expect(nock.isDone()).toBe(true);
  });

  describe("getCheckoutIntent (#404)", () => {
    const tokenOk = () =>
      nock(HELLOASSO_API)
        .post("/oauth2/token")
        .reply(200, { access_token: "tok-abc", expires_in: 3600 });

    it("relit l'intention de paiement avec le jeton du club", async () => {
      tokenOk();
      nock(HELLOASSO_API, {
        reqheaders: { authorization: "Bearer tok-abc" },
      })
        .get("/v5/organizations/org-slug/checkout-intents/4242")
        .reply(200, {
          id: 4242,
          redirectUrl: "https://x",
          metadata: { bookingId: "booking-1" },
          order: {
            id: 98765,
            payments: [{ amount: 1500, state: "Authorized" }],
          },
        });

      const result = await service.getCheckoutIntent(credentials, "4242");

      expect(result).toEqual({
        found: true,
        value: expect.objectContaining({ id: 4242 }),
      });
    });

    it("renvoie found=false sur 404", async () => {
      tokenOk();
      nock(HELLOASSO_API)
        .get("/v5/organizations/org-slug/checkout-intents/4242")
        .reply(404, { message: "Not found" });

      await expect(
        service.getCheckoutIntent(credentials, "4242"),
      ).resolves.toEqual({
        found: false,
      });
    });

    it("renvoie found=false sur 403 (objet d'une autre organisation)", async () => {
      tokenOk();
      nock(HELLOASSO_API)
        .get("/v5/organizations/org-slug/checkout-intents/4242")
        .reply(403, {});

      await expect(
        service.getCheckoutIntent(credentials, "4242"),
      ).resolves.toEqual({ found: false });
    });

    it("ne compte pas un 404 comme une panne du coupe-circuit", async () => {
      const outcomes: string[] = [];
      const observingBreaker = {
        fire: jest.fn(async (_key: string, fn: () => Promise<unknown>) => {
          try {
            const value = await fn();
            outcomes.push("success");
            return value;
          } catch (error) {
            outcomes.push("failure");
            throw error;
          }
        }),
      } as unknown as CircuitBreakerService;
      const observed = new HelloAssoService(observingBreaker, {
        get: jest.fn(),
      } as unknown as ConfigService);
      tokenOk();
      nock(HELLOASSO_API)
        .get("/v5/organizations/org-slug/checkout-intents/4242")
        .reply(404, {});

      await observed.getCheckoutIntent(credentials, "4242");

      // token request + read: both successes from the breaker's viewpoint
      expect(outcomes).toEqual(["success", "success"]);
    });

    it("propage les autres erreurs (5xx) pour que la notification soit rejouée", async () => {
      tokenOk();
      nock(HELLOASSO_API)
        .get("/v5/organizations/org-slug/checkout-intents/4242")
        .reply(503, {});

      await expect(
        service.getCheckoutIntent(credentials, "4242"),
      ).rejects.toThrow();
    });

    it("n'appelle jamais HelloAsso avec un identifiant non numérique", async () => {
      await expect(
        service.getCheckoutIntent(credentials, "../payments/1"),
      ).resolves.toEqual({ found: false });
      expect(nock.pendingMocks()).toHaveLength(0);
    });
  });
  describe("getPayment / getOrder (#403)", () => {
    const tokenOk = () =>
      nock(HELLOASSO_API)
        .post("/oauth2/token")
        .reply(200, { access_token: "tok-abc", expires_in: 3600 });

    it("relit un paiement par son identifiant", async () => {
      tokenOk();
      nock(HELLOASSO_API, { reqheaders: { authorization: "Bearer tok-abc" } })
        .get("/v5/payments/555")
        .reply(200, {
          id: 555,
          amount: 1500,
          state: "Refunded",
          order: { id: 98765 },
        });

      await expect(service.getPayment(credentials, "555")).resolves.toEqual({
        found: true,
        value: expect.objectContaining({ state: "Refunded" }),
      });
    });

    it("relit une commande par son identifiant", async () => {
      tokenOk();
      nock(HELLOASSO_API)
        .get("/v5/orders/98765")
        .reply(200, { id: 98765, checkoutIntentId: 4242 });

      await expect(service.getOrder(credentials, "98765")).resolves.toEqual({
        found: true,
        value: expect.objectContaining({ checkoutIntentId: 4242 }),
      });
    });

    it("renvoie found=false sur 404", async () => {
      tokenOk();
      nock(HELLOASSO_API).get("/v5/payments/555").reply(404, {});

      await expect(service.getPayment(credentials, "555")).resolves.toEqual({
        found: false,
      });
    });

    it("refuse un identifiant non numérique sans appeler HelloAsso", async () => {
      await expect(service.getPayment(credentials, "1/../x")).resolves.toEqual({
        found: false,
      });
      await expect(service.getOrder(credentials, "abc")).resolves.toEqual({
        found: false,
      });
    });
  });
});
