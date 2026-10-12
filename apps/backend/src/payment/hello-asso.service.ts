import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { createHash } from "crypto";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { withTimeout } from "../utils/timeout.utils";
import { DEFAULT_HELLOASSO_API_URL } from "./helloasso-api-urls";

export interface HelloAssoCredentials {
  clientId: string;
  clientSecret: string;
  organizationSlug: string;
}

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

interface HelloAssoTokenResponse {
  access_token: string;
  expires_in: number;
}

export interface HelloAssoCheckoutIntent {
  id: number;
  redirectUrl: string;
  [key: string]: unknown;
}

/**
 * `GET /v5/organizations/{slug}/checkout-intents/{id}` (#404). `order` is
 * only present once the payment is authorized. Typed as `unknown` on purpose:
 * the caller validates every field it relies on (fail-closed).
 */
export interface HelloAssoCheckoutIntentDetail {
  id?: unknown;
  metadata?: unknown;
  order?: unknown;
}

/** `GET /v5/payments/{paymentId}` (#403), validated by the caller. */
export interface HelloAssoPaymentDetail {
  id?: unknown;
  amount?: unknown;
  state?: unknown;
  order?: unknown;
}

/** `GET /v5/orders/{orderId}` (#403), validated by the caller. */
export interface HelloAssoOrderDetail {
  id?: unknown;
  checkoutIntentId?: unknown;
}

/** HelloAsso ids are positive integers; other values never reach a URL. */
const NUMERIC_ID = /^[1-9]\d{0,17}$/;

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Outcome of a read: `not_found` is a definitive answer (unknown id for this
 * organization); any other failure (network, 5xx, open circuit) throws.
 */
export type HelloAssoReadResult<T> =
  | { found: true; value: T }
  | { found: false };

/**
 * 404 (unknown id) and 403 (object of another organization) are ANSWERS, not
 * outages: they must never count as failures in the shared `helloasso`
 * circuit breaker, otherwise a caller naming non-existent ids could open it
 * and block every club's checkout.
 */
function isDefinitiveMiss(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === 404 || status === 403;
}

function isRejectedCredentials(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === 400 || status === 401;
}

@Injectable()
export class HelloAssoService {
  private readonly logger = new Logger(HelloAssoService.name);
  /** Cache des tokens par clientId pour éviter de redemander un token à chaque requête */
  private readonly tokenCache = new Map<string, TokenCacheEntry>();
  private readonly apiUrl: string;

  constructor(
    private readonly circuitBreakerService: CircuitBreakerService,
    configService: ConfigService,
  ) {
    this.apiUrl =
      configService.get<string>("HELLOASSO_API_URL") ??
      DEFAULT_HELLOASSO_API_URL;
  }

  /**
   * Get OAuth token for HelloAsso API using club credentials
   */
  private async getAccessToken(
    credentials: HelloAssoCredentials,
  ): Promise<string> {
    // Keyed on the secret too: a club registering another club's clientId
    // with a wrong secret never gets that club's cached token.
    const cacheKey = `${credentials.clientId}:${createHash("sha256").update(credentials.clientSecret).digest("hex")}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.token;
    }

    try {
      const outcome = await this.circuitBreakerService.fire(
        "helloasso",
        async (): Promise<
          | { ok: true; data: HelloAssoTokenResponse }
          | { ok: false; error: unknown }
        > => {
          try {
            const response = await withTimeout(
              axios.post<HelloAssoTokenResponse>(
                `${this.apiUrl}/oauth2/token`,
                new URLSearchParams({
                  grant_type: "client_credentials",
                  client_id: credentials.clientId,
                  client_secret: credentials.clientSecret,
                }),
                {
                  headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                  },
                },
              ),
              REQUEST_TIMEOUT_MS,
              "HelloAsso.getAccessToken",
            );
            return { ok: true, data: response.data };
          } catch (error) {
            // Rejected credentials (400/401) are this club's answer, not a
            // HelloAsso outage: never counted by the breaker.
            if (isRejectedCredentials(error)) return { ok: false, error };
            throw error;
          }
        },
        this.breakerScope(credentials),
      );
      if (!outcome.ok) throw outcome.error;

      const token = outcome.data.access_token;
      const expiresAt = Date.now() + outcome.data.expires_in * 1000 - 60000; // Buffer 1 min
      this.tokenCache.set(cacheKey, { token, expiresAt });
      return token;
    } catch (error) {
      // Never log the axios error itself: its config carries the client secret.
      this.logger.error(
        `Failed to get HelloAsso access token (${axios.isAxiosError(error) ? (error.response?.status ?? error.code) : "unknown"})`,
      );
      throw error;
    }
  }

  /**
   * Breaker scope (#404): one per HelloAsso organisation, so that one
   * club's outage, bad credentials or forged-notification traffic never opens
   * the breaker of the other clubs.
   */
  private breakerScope(credentials: HelloAssoCredentials): string {
    return credentials.organizationSlug;
  }

  private organizationUrl(credentials: HelloAssoCredentials): string {
    return `${this.apiUrl}/v5/organizations/${encodeURIComponent(credentials.organizationSlug)}`;
  }

  /**
   * Create a checkout intent for a seat booking using the club's HelloAsso account
   */
  async createCheckoutIntent(
    credentials: HelloAssoCredentials,
    appBaseUrl: string,
    params: {
      amount: number;
      label: string;
      consumerEmail: string;
      consumerFirstName: string;
      consumerLastName: string;
      metadata: Record<string, unknown>;
    },
  ) {
    const token = await this.getAccessToken(credentials);

    try {
      const response = await this.circuitBreakerService.fire(
        "helloasso",
        () =>
          withTimeout(
            axios.post<HelloAssoCheckoutIntent>(
              `${this.organizationUrl(credentials)}/checkout-intents`,
              {
                totalAmount: params.amount,
                initialAmount: params.amount,
                itemName: params.label,
                backUrl: appBaseUrl + "/payment/back",
                errorUrl: appBaseUrl + "/payment/error",
                returnUrl: appBaseUrl + "/payment/success",
                containsDonation: false,
                payer: {
                  firstName: params.consumerFirstName,
                  lastName: params.consumerLastName,
                  email: params.consumerEmail,
                },
                metadata: params.metadata,
              },
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              },
            ),
            REQUEST_TIMEOUT_MS,
            "HelloAsso.createCheckoutIntent",
          ),
        this.breakerScope(credentials),
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to create HelloAsso checkout intent (${axios.isAxiosError(error) ? (error.response?.status ?? error.code) : "unknown"})`,
      );
      throw error;
    }
  }

  /**
   * Authenticated GET on the HelloAsso API. 404/403 → `{ found: false }`,
   * resolved INSIDE the circuit breaker (not counted as a failure); network
   * errors, timeouts and 5xx throw and count.
   */
  private async get<T>(
    credentials: HelloAssoCredentials,
    url: string,
    label: string,
  ): Promise<HelloAssoReadResult<T>> {
    const token = await this.getAccessToken(credentials);
    try {
      return await this.circuitBreakerService.fire(
        "helloasso",
        async (): Promise<HelloAssoReadResult<T>> => {
          try {
            const response = await withTimeout(
              axios.get<T>(url, {
                headers: { Authorization: `Bearer ${token}` },
              }),
              REQUEST_TIMEOUT_MS,
              label,
            );
            return { found: true, value: response.data };
          } catch (error) {
            if (isDefinitiveMiss(error)) return { found: false };
            throw error;
          }
        },
        this.breakerScope(credentials),
      );
    } catch (error) {
      this.logger.error(
        `${label} failed (${axios.isAxiosError(error) ? (error.response?.status ?? error.code) : "unknown"})`,
      );
      throw error;
    }
  }

  /**
   * Re-reads a checkout intent from HelloAsso (#404): the authoritative state
   * of a payment, whatever a notification claims. `order` is present only
   * once the payment is authorized.
   */
  async getCheckoutIntent(
    credentials: HelloAssoCredentials,
    checkoutIntentId: string,
  ): Promise<HelloAssoReadResult<HelloAssoCheckoutIntentDetail>> {
    if (!NUMERIC_ID.test(checkoutIntentId)) return { found: false };
    return this.get<HelloAssoCheckoutIntentDetail>(
      credentials,
      `${this.organizationUrl(credentials)}/checkout-intents/${checkoutIntentId}`,
      "HelloAsso.getCheckoutIntent",
    );
  }
  /**
   * Re-reads a payment from HelloAsso (#403): its current state (Authorized,
   * Refunded, Contested…) whatever a notification claims.
   */
  async getPayment(
    credentials: HelloAssoCredentials,
    paymentId: string,
  ): Promise<HelloAssoReadResult<HelloAssoPaymentDetail>> {
    if (!NUMERIC_ID.test(paymentId)) return { found: false };
    return this.get<HelloAssoPaymentDetail>(
      credentials,
      `${this.apiUrl}/v5/payments/${paymentId}`,
      "HelloAsso.getPayment",
    );
  }

  /** Re-reads an order from HelloAsso (#403), e.g. for its checkout intent id. */
  async getOrder(
    credentials: HelloAssoCredentials,
    orderId: string,
  ): Promise<HelloAssoReadResult<HelloAssoOrderDetail>> {
    if (!NUMERIC_ID.test(orderId)) return { found: false };
    return this.get<HelloAssoOrderDetail>(
      credentials,
      `${this.apiUrl}/v5/orders/${orderId}`,
      "HelloAsso.getOrder",
    );
  }
}
