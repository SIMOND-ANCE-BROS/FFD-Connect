import axios from "axios";
import type { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { HelloAssoService } from "./hello-asso.service";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("HelloAssoService", () => {
  let service: HelloAssoService;
  let mockCircuitBreaker: jest.Mocked<Pick<CircuitBreakerService, "fire">>;

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

  beforeEach(() => {
    jest.clearAllMocks();
    mockCircuitBreaker = {
      fire: jest.fn().mockImplementation((_key, fn) => fn()),
    };
    service = new HelloAssoService(
      mockCircuitBreaker as unknown as CircuitBreakerService,
    );
  });

  describe("createCheckoutIntent", () => {
    it("requests an OAuth token before creating the intent", async () => {
      mockedAxios.post
        .mockResolvedValueOnce({
          data: { access_token: "tok", expires_in: 3600 },
        })
        .mockResolvedValueOnce({
          data: { id: "intent-1", redirectUrl: "https://helloasso.com" },
        });

      await service.createCheckoutIntent(
        credentials,
        "https://app.example.com",
        checkoutParams,
      );

      expect(mockedAxios.post).toHaveBeenNthCalledWith(
        1,
        "https://api.helloasso.com/oauth2/token",
        expect.any(URLSearchParams),
        expect.objectContaining({
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }),
      );
    });

    it("passes the Bearer token to the checkout intent request", async () => {
      mockedAxios.post
        .mockResolvedValueOnce({
          data: { access_token: "my-token", expires_in: 3600 },
        })
        .mockResolvedValueOnce({
          data: { id: "intent-1", redirectUrl: "https://helloasso.com" },
        });

      await service.createCheckoutIntent(
        credentials,
        "https://app.example.com",
        checkoutParams,
      );

      expect(mockedAxios.post).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(credentials.organizationSlug),
        expect.any(Object),
        expect.objectContaining({
          headers: { Authorization: "Bearer my-token" },
        }),
      );
    });

    it("sends correct body to checkout intent endpoint", async () => {
      mockedAxios.post
        .mockResolvedValueOnce({
          data: { access_token: "tok", expires_in: 3600 },
        })
        .mockResolvedValueOnce({
          data: { id: "intent-1", redirectUrl: "https://helloasso.com" },
        });

      await service.createCheckoutIntent(
        credentials,
        "https://app.example.com",
        checkoutParams,
      );

      expect(mockedAxios.post).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({
          totalAmount: checkoutParams.amount,
          itemName: checkoutParams.label,
          payer: {
            firstName: checkoutParams.consumerFirstName,
            lastName: checkoutParams.consumerLastName,
            email: checkoutParams.consumerEmail,
          },
          metadata: checkoutParams.metadata,
        }),
        expect.any(Object),
      );
    });

    it("returns the checkout intent data", async () => {
      const intent = {
        id: "intent-1",
        redirectUrl: "https://helloasso.com/checkout/intent-1",
      };
      mockedAxios.post
        .mockResolvedValueOnce({
          data: { access_token: "tok", expires_in: 3600 },
        })
        .mockResolvedValueOnce({ data: intent });

      const result = await service.createCheckoutIntent(
        credentials,
        "https://app.example.com",
        checkoutParams,
      );

      expect(result).toEqual(intent);
    });

    it("caches the token for subsequent calls with the same clientId", async () => {
      mockedAxios.post
        .mockResolvedValueOnce({
          data: { access_token: "tok", expires_in: 3600 },
        })
        .mockResolvedValue({
          data: { id: "intent-x", redirectUrl: "https://helloasso.com" },
        });

      await service.createCheckoutIntent(
        credentials,
        "https://app.example.com",
        checkoutParams,
      );
      await service.createCheckoutIntent(
        credentials,
        "https://app.example.com",
        checkoutParams,
      );

      // Token endpoint called only once despite two checkout calls
      const tokenCalls = mockedAxios.post.mock.calls.filter((c) =>
        c[0].includes("oauth2/token"),
      );
      expect(tokenCalls).toHaveLength(1);
    });

    it("throws when the token request fails", async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error("Network error"));

      await expect(
        service.createCheckoutIntent(
          credentials,
          "https://app.example.com",
          checkoutParams,
        ),
      ).rejects.toThrow("Network error");
    });

    it("throws when the checkout intent request fails", async () => {
      mockedAxios.post
        .mockResolvedValueOnce({
          data: { access_token: "tok", expires_in: 3600 },
        })
        .mockRejectedValueOnce(new Error("HelloAsso API error"));

      await expect(
        service.createCheckoutIntent(
          credentials,
          "https://app.example.com",
          checkoutParams,
        ),
      ).rejects.toThrow("HelloAsso API error");
    });

    it("uses correct checkout intent URL with organization slug", async () => {
      mockedAxios.post
        .mockResolvedValueOnce({
          data: { access_token: "tok", expires_in: 3600 },
        })
        .mockResolvedValueOnce({ data: { id: "intent-1", redirectUrl: "" } });

      await service.createCheckoutIntent(
        credentials,
        "https://app.example.com",
        checkoutParams,
      );

      const checkoutCall = mockedAxios.post.mock.calls[1];
      expect(checkoutCall[0]).toBe(
        `https://api.helloasso.com/v1/organizations/${credentials.organizationSlug}/checkout-intents`,
      );
    });

    it("builds return URLs from appBaseUrl", async () => {
      mockedAxios.post
        .mockResolvedValueOnce({
          data: { access_token: "tok", expires_in: 3600 },
        })
        .mockResolvedValueOnce({ data: { id: "intent-1", redirectUrl: "" } });

      await service.createCheckoutIntent(
        credentials,
        "https://myapp.com",
        checkoutParams,
      );

      expect(mockedAxios.post).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({
          backUrl: "https://myapp.com/payment/back",
          errorUrl: "https://myapp.com/payment/error",
          returnUrl: "https://myapp.com/payment/success",
        }),
        expect.any(Object),
      );
    });

    it("throws when token request returns 401 Unauthorized", async () => {
      const unauthorizedError = Object.assign(
        new Error("Request failed with status code 401"),
        {
          response: {
            status: 401,
            data: {
              error: "Unauthorized",
              message: "Invalid client credentials",
            },
          },
        },
      );
      mockedAxios.post.mockRejectedValueOnce(unauthorizedError);

      await expect(
        service.createCheckoutIntent(
          credentials,
          "https://app.example.com",
          checkoutParams,
        ),
      ).rejects.toThrow("Request failed with status code 401");
    });

    it("throws when checkout intent request returns 401 Unauthorized", async () => {
      const unauthorizedError = Object.assign(
        new Error("Request failed with status code 401"),
        {
          response: { status: 401, data: { error: "Unauthorized" } },
        },
      );
      mockedAxios.post
        .mockResolvedValueOnce({
          data: { access_token: "tok", expires_in: 3600 },
        })
        .mockRejectedValueOnce(unauthorizedError);

      await expect(
        service.createCheckoutIntent(
          credentials,
          "https://app.example.com",
          checkoutParams,
        ),
      ).rejects.toThrow("Request failed with status code 401");
    });

    it("throws when checkout intent request returns 500 Internal Server Error", async () => {
      const serverError = Object.assign(
        new Error("Request failed with status code 500"),
        {
          response: { status: 500, data: { error: "Internal Server Error" } },
        },
      );
      mockedAxios.post
        .mockResolvedValueOnce({
          data: { access_token: "tok", expires_in: 3600 },
        })
        .mockRejectedValueOnce(serverError);

      await expect(
        service.createCheckoutIntent(
          credentials,
          "https://app.example.com",
          checkoutParams,
        ),
      ).rejects.toThrow("Request failed with status code 500");
    });

    it("throws on network timeout (ECONNABORTED)", async () => {
      const timeoutError = Object.assign(
        new Error("timeout of 5000ms exceeded"),
        {
          code: "ECONNABORTED",
        },
      );
      mockedAxios.post
        .mockResolvedValueOnce({
          data: { access_token: "tok", expires_in: 3600 },
        })
        .mockRejectedValueOnce(timeoutError);

      await expect(
        service.createCheckoutIntent(
          credentials,
          "https://app.example.com",
          checkoutParams,
        ),
      ).rejects.toThrow("timeout");
    });

    it("throws on network connection refused (ECONNREFUSED)", async () => {
      const networkError = Object.assign(
        new Error("connect ECONNREFUSED 127.0.0.1:443"),
        {
          code: "ECONNREFUSED",
        },
      );
      mockedAxios.post.mockRejectedValueOnce(networkError);

      await expect(
        service.createCheckoutIntent(
          credentials,
          "https://app.example.com",
          checkoutParams,
        ),
      ).rejects.toThrow("ECONNREFUSED");
    });
  });
});
