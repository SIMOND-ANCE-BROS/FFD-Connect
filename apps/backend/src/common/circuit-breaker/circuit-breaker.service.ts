import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import CircuitBreaker from "opossum";

type BreakerKey =
  | "azure-vision"
  | "azure-tts"
  | "wdsf"
  | "helloasso"
  | "fcm"
  | "azure-blob"
  | "azure-blob-write"
  | "ffd-documents";

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
};

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly breakers = new Map<
    BreakerKey,
    CircuitBreaker<[() => Promise<unknown>], unknown>
  >();

  private getBreaker(
    key: BreakerKey,
  ): CircuitBreaker<[() => Promise<unknown>], unknown> {
    if (!this.breakers.has(key)) {
      const config = BREAKER_CONFIGS[key];
      const breaker = new CircuitBreaker(
        async (fn: () => Promise<unknown>) => fn(),
        {
          errorThresholdPercentage: config.errorThresholdPercentage,
          timeout: config.timeout,
          resetTimeout: config.resetTimeout,
          volumeThreshold: config.volumeThreshold,
        },
      );

      breaker.on("open", () =>
        this.logger.warn(
          `Circuit breaker OPEN for ${key}`,
          CircuitBreakerService.name,
        ),
      );
      breaker.on("halfOpen", () =>
        this.logger.log(
          `Circuit breaker HALF-OPEN for ${key}`,
          CircuitBreakerService.name,
        ),
      );
      breaker.on("close", () =>
        this.logger.log(
          `Circuit breaker CLOSED for ${key}`,
          CircuitBreakerService.name,
        ),
      );

      this.breakers.set(key, breaker);
    }
    return this.breakers.get(key)!;
  }

  async fire<T>(key: BreakerKey, fn: () => Promise<T>): Promise<T> {
    const breaker = this.getBreaker(key);
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
