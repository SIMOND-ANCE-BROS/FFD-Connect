import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { withTimeout } from "../utils/timeout.utils";

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
  id: string;
  redirectUrl: string;
  [key: string]: unknown;
}

@Injectable()
export class HelloAssoService {
  private readonly logger = new Logger(HelloAssoService.name);
  /** Cache des tokens par clientId pour éviter de redemander un token à chaque requête */
  private readonly tokenCache = new Map<string, TokenCacheEntry>();

  constructor(private readonly circuitBreakerService: CircuitBreakerService) {}

  /**
   * Get OAuth token for HelloAsso API using club credentials
   */
  private async getAccessToken(credentials: {
    clientId: string;
    clientSecret: string;
  }): Promise<string> {
    const cached = this.tokenCache.get(credentials.clientId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.token;
    }

    try {
      const response = await this.circuitBreakerService.fire("helloasso", () =>
        withTimeout(
          axios.post<HelloAssoTokenResponse>(
            "https://api.helloasso.com/oauth2/token",
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
          10_000,
          "HelloAsso.getAccessToken",
        ),
      );

      const token = response.data.access_token;
      const expiresAt = Date.now() + response.data.expires_in * 1000 - 60000; // Buffer 1 min
      this.tokenCache.set(credentials.clientId, { token, expiresAt });
      return token;
    } catch (error) {
      this.logger.error("Failed to get HelloAsso access token", error);
      throw error;
    }
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
    const token = await this.getAccessToken({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    });

    try {
      const response = await this.circuitBreakerService.fire("helloasso", () =>
        withTimeout(
          axios.post<HelloAssoCheckoutIntent>(
            `https://api.helloasso.com/v1/organizations/${credentials.organizationSlug}/checkout-intents`,
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
          10_000,
          "HelloAsso.createCheckoutIntent",
        ),
      );

      return response.data;
    } catch (error) {
      this.logger.error("Failed to create HelloAsso checkout intent", error);
      throw error;
    }
  }
}
