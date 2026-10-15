import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import CircuitBreaker from "opossum";
import { isCallerError } from "./caller-error";

type BreakerKey =
  | "azure-vision"
  | "azure-tts"
  | "wdsf"
  | "helloasso"
  | "fcm"
  | "azure-blob"
  | "azure-blob-write"
  | "ffd-documents"
  | "email";

interface BreakerConfig {
  errorThresholdPercentage: number;
  timeout: number;
  resetTimeout: number;
  volumeThreshold: number;
}

const BREAKER_CONFIGS: Record<BreakerKey, BreakerConfig> = {
  "azure-vision": {
    errorThresholdPercentage: 50,
    timeout: 15_000,
    resetTimeout: 30_000,
    volumeThreshold: 5,
  },
  "azure-tts": {
    errorThresholdPercentage: 50,
    timeout: 10_000,
    resetTimeout: 30_000,
    volumeThreshold: 5,
  },
  wdsf: {
    errorThresholdPercentage: 50,
    timeout: 30_000,
    resetTimeout: 60_000,
    volumeThreshold: 5,
  },
  helloasso: {
    errorThresholdPercentage: 50,
    timeout: 15_000,
    resetTimeout: 30_000,
    volumeThreshold: 3,
  },
  // Firebase Cloud Messaging. Un envoi peut s'ouvrir en éventail sur tous les
  // appareils d'un utilisateur depuis un chemin HTTP (validation d'inscription) :
  // le timeout est court, l'envoi push étant best-effort.
  fcm: {
    errorThresholdPercentage: 50,
    timeout: 8_000,
    resetTimeout: 30_000,
    volumeThreshold: 5,
  },
  // Blob reads behind the /uploads fallback: only the metadata call and the
  // start of the download (response headers) are bounded, not the body stream.
  "azure-blob": {
    errorThresholdPercentage: 50,
    timeout: 10_000,
    resetTimeout: 30_000,
    volumeThreshold: 5,
  },
  // Track file uploads of the back-office import (up to 20 MB each): their own
  // breaker, so their longer budget does not loosen the /uploads reads.
  "azure-blob-write": {
    errorThresholdPercentage: 50,
    timeout: 45_000,
    resetTimeout: 30_000,
    volumeThreshold: 5,
  },
  // FFD circular PDFs downloaded by the sync (temporary épreuves deduction).
  // The call is also bounded by withTimeout(20s); this is the outer guard.
  "ffd-documents": {
    errorThresholdPercentage: 50,
    timeout: 25_000,
    resetTimeout: 60_000,
    volumeThreshold: 5,
  },
  // Transactional email (Resend). Best-effort notices only: the caller
  // degrades gracefully, so a mail outage never fails the business write.
  email: {
    errorThresholdPercentage: 50,
    timeout: 10_000,
    resetTimeout: 30_000,
    volumeThreshold: 5,
  },
};

/**
 * Upper bound on scoped breakers kept in memory (one per scope, e.g. per
 * HelloAsso organisation). The oldest scope is dropped beyond it: losing a
 * breaker's history only resets it to CLOSED.
 */
export const MAX_SCOPED_BREAKERS = 500;

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly breakers = new Map<
    string,
    CircuitBreaker<[() => Promise<unknown>], unknown>
  >();

  private getBreaker(
    key: BreakerKey,
    scope?: string,
  ): CircuitBreaker<[() => Promise<unknown>], unknown> {
    const id = scope === undefined ? key : `${key}:${scope}`;
    if (!this.breakers.has(id)) {
      if (scope !== undefined) this.evictOldestScopedIfFull();
      const config = BREAKER_CONFIGS[key];
      const breaker = new CircuitBreaker(
        async (fn: () => Promise<unknown>) => fn(),
        {
          errorThresholdPercentage: config.errorThresholdPercentage,
          timeout: config.timeout,
          resetTimeout: config.resetTimeout,
          volumeThreshold: config.volumeThreshold,
          // A 4xx answer (bad id, missing file, refused payload) is the
          // caller's fault, not an outage: rethrown, never counted (#437).
          errorFilter: isCallerError,
        },
      );

      breaker.on("open", () =>
        this.logger.warn(
          `Circuit breaker OPEN for ${id}`,
          CircuitBreakerService.name,
        ),
      );
      breaker.on("halfOpen", () =>
        this.logger.log(
          `Circuit breaker HALF-OPEN for ${id}`,
          CircuitBreakerService.name,
        ),
      );
      breaker.on("close", () =>
        this.logger.log(
          `Circuit breaker CLOSED for ${id}`,
          CircuitBreakerService.name,
        ),
      );

      this.breakers.set(id, breaker);
    }
    return this.breakers.get(id)!;
  }

  private evictOldestScopedIfFull(): void {
    const scoped = [...this.breakers.keys()].filter((id) => id.includes(":"));
    if (scoped.length < MAX_SCOPED_BREAKERS) return;
    const oldest = scoped[0];
    this.breakers.get(oldest)?.shutdown();
    this.breakers.delete(oldest);
  }

  /**
   * Runs `fn` through the breaker of `key`. With a `scope` (e.g. a HelloAsso
   * organisation), failures are counted per scope: one tenant's outage or
   * bad credentials never opens the breaker for the others.
   *
   * A caller error raised by `fn` (remote 4xx other than 408/429, see
   * `isCallerError`) is rethrown as is and never counted as a failure:
   * only 5xx, 408/429, timeouts and network errors can open the breaker.
   */
  async fire<T>(
    key: BreakerKey,
    fn: () => Promise<T>,
    scope?: string,
  ): Promise<T> {
    const breaker = this.getBreaker(key, scope);
    try {
      return (await breaker.fire(fn)) as T;
    } catch (err) {
      if (breaker.opened) {
        throw new ServiceUnavailableException(
          `Service ${key} is temporarily unavailable. Please try again later.`,
        );
      }
      throw err;
    }
  }
}
