/**
 * Utilitaire de retry pour les requêtes réseau
 * Implémente une stratégie de retry avec backoff exponentiel
 */

export interface RetryOptions {
  /** Nombre maximum de tentatives (défaut: 3) */
  maxRetries?: number;
  /** Délai initial en millisecondes (défaut: 1000) */
  initialDelay?: number;
  /** Facteur de multiplication pour le backoff exponentiel (défaut: 2) */
  backoffFactor?: number;
  /** Délai maximum entre les tentatives en millisecondes (défaut: 10000) */
  maxDelay?: number;
  /** Fonction pour déterminer si une erreur doit être retentée */
  shouldRetry?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelay: 1000,
  backoffFactor: 2,
  maxDelay: 10000,
  shouldRetry: (error: unknown) => {
    // Retry sur les erreurs réseau et les erreurs 5xx
    if (error && typeof error === "object" && "response" in error) {
      const axiosError = error as { response?: { status?: number } };
      const status = axiosError.response?.status;
      return !status || status >= 500 || status === 408 || status === 429;
    }
    // Retry sur les erreurs réseau (pas de response)
    // Retry sur les erreurs TypeError (fetch failures)
    if (error instanceof TypeError && error.message.includes("fetch")) {
      return true;
    }
    // Retry sur les HttpError avec codes appropriés (si importé depuis httpInterceptor)
    if (error && typeof error === "object" && "statusCode" in error) {
      const httpError = error as { statusCode: number };
      const status = httpError.statusCode;
      return (
        status === 0 ||
        status === 408 ||
        status === 429 ||
        (status >= 500 && status < 600)
      );
    }
    return true;
  },
};

/**
 * Calcule le délai avant la prochaine tentative avec backoff exponentiel
 */
function calculateDelay(
  attempt: number,
  options: Required<RetryOptions>,
): number {
  const delay = options.initialDelay * Math.pow(options.backoffFactor, attempt);
  return Math.min(delay, options.maxDelay);
}

/**
 * Retry une fonction asynchrone avec backoff exponentiel
 *
 * @param fn - Fonction à exécuter avec retry
 * @param options - Options de retry
 * @returns Résultat de la fonction
 *
 * @example
 * ```typescript
 * const result = await retry(
 *   () => api.get('/competitions'),
 *   { maxRetries: 3, initialDelay: 1000 }
 * );
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Ne pas retry si c'est la dernière tentative
      if (attempt >= opts.maxRetries) {
        break;
      }

      // Vérifier si l'erreur doit être retentée
      if (!opts.shouldRetry(error)) {
        throw error;
      }

      // Attendre avant la prochaine tentative
      const delay = calculateDelay(attempt, opts);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Wrapper axios avec retry automatique
 *
 * @param axiosRequest - Fonction axios à wrapper
 * @param options - Options de retry
 * @returns Promise avec retry automatique
 *
 * @example
 * ```typescript
 * const response = await retryAxios(
 *   () => api.get('/competitions'),
 *   { maxRetries: 3 }
 * );
 * ```
 */
export function retryAxios<T>(
  axiosRequest: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  return retry(axiosRequest, {
    shouldRetry: (error) => {
      // Ne pas retry sur les erreurs 4xx (sauf 408, 429)
      if (error && typeof error === "object" && "response" in error) {
        const axiosError = error as { response?: { status?: number } };
        const status = axiosError.response?.status;
        if (
          status &&
          status >= 400 &&
          status < 500 &&
          status !== 408 &&
          status !== 429
        ) {
          return false;
        }
      }
      return DEFAULT_OPTIONS.shouldRetry(error);
    },
    ...options,
  });
}
