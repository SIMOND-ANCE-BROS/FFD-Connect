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
    service = new HelloAssoService(mockCircuitBreaker);
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
        .post("/v1/organizations/org-slug/checkout-intents")
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
        .post("/v1/organizations/org-slug/checkout-intents")
        .reply(200, { id: "intent-1", redirectUrl: "https://helloasso.com/1" });

      await service.createCheckoutIntent(
        credentials,
        "https://app.example.com",
        checkoutParams,
      );

      // Second call: no new nock for token — nock would throw if token endpoint is called again
      nock(HELLOASSO_API)
        .post("/v1/organizations/org-slug/checkout-intents")
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
        .post("/v1/organizations/org-slug/checkout-intents")
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
        .post("/v1/organizations/org-slug/checkout-intents")
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
});
