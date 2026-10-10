import { ERROR_MESSAGES } from "../constants/errorMessages";
import { createLogger } from "./logger";
import { retry, RetryOptions } from "./retry";

const logger = createLogger("HTTP");

/**
 * Type pour les données d'erreur HTTP
 */
export type HttpErrorData = Record<string, unknown> | string | null;

/**
 * Détails d'une erreur serveur « codée » (#225) : un code stable et le texte
 * rédigé pour l'utilisateur, qui peut contenir des données personnelles
 * (refus médical d'un certificat).
 */
export interface HttpErrorDetails {
  code?: string;
  userMessage?: string;
}

/**
 * Erreur HTTP personnalisée
 */
export class HttpError extends Error {
  /** Code stable renvoyé par le serveur, quand il y en a un. */
  public readonly code?: string;
  /**
   * Texte du serveur destiné à l'utilisateur : à AFFICHER, jamais à
   * journaliser. Non énumérable, comme `code`, pour qu'aucune sérialisation de
   * l'erreur (logger, Sentry) ne l'emporte.
   */
  public readonly userMessage?: string;

  constructor(
    public statusCode: number,
    public statusText: string,
    public data?: HttpErrorData,
    message?: string,
    details: HttpErrorDetails = {},
  ) {
    super(message ?? `HTTP ${statusCode}: ${statusText}`);
    this.name = "HttpError";
    Object.defineProperty(this, "code", {
      value: details.code,
      enumerable: false,
    });
    Object.defineProperty(this, "userMessage", {
      value: details.userMessage,
      enumerable: false,
    });
  }
}

/**
 * Construit l'HttpError d'une réponse en erreur.
 *
 * Un corps « codé » (#225, ex. refus médical d'un certificat) porte un texte
 * qui peut être une donnée de santé : l'erreur prend alors un message
 * générique (`fallbackMessage`), seul visible des logs et de Sentry, ne garde
 * pas le corps dans `data`, et range le code et le texte serveur dans les
 * champs non énumérables `code` / `userMessage`. Sans code, comportement
 * historique : le message du serveur devient celui de l'erreur.
 */
export function httpErrorFromBody(
  statusCode: number,
  statusText: string,
  body: HttpErrorData,
  fallbackMessage: string,
): HttpError {
  const record = body && typeof body === "object" ? body : null;
  const code =
    typeof record?.code === "string" && record.code.length > 0
      ? record.code
      : undefined;
  const serverMessage =
    typeof record?.message === "string" ? record.message : undefined;
  if (code) {
    return new HttpError(statusCode, statusText, null, fallbackMessage, {
      code,
      userMessage: serverMessage,
    });
  }
  return new HttpError(
    statusCode,
    statusText,
    body,
    serverMessage ?? fallbackMessage,
  );
}

/**
 * Options pour les requêtes HTTP
 */
export interface HttpRequestOptions extends RequestInit {
  /**
   * Si true, log les erreurs automatiquement
   */
  logErrors?: boolean;
  /**
   * Statuts HTTP attendus (ex. 409 métier) : l'HttpError est levée sans être
   * loguée (ni Sentry), même avec `logErrors`.
   */
  quietStatuses?: readonly number[];
  /**
   * Message d'erreur personnalisé
   */
  errorMessage?: string;
  /**
   * Timeout en millisecondes
   */
  timeout?: number;
  /**
   * Options de retry automatique. Si défini, active le retry avec backoff exponentiel.
   * Par défaut, le retry est désactivé.
   */
  retry?: RetryOptions | boolean;
}

/**
 * Détermine si une erreur HTTP doit être retentée
 */
function shouldRetryHttpError(error: unknown): boolean {
  if (error instanceof HttpError) {
    const status = error.statusCode;
    // Retry sur les erreurs réseau (0), timeout (408), rate limit (429), et erreurs serveur (5xx)
    return (
      status === 0 ||
      status === 408 ||
      status === 429 ||
      (status >= 500 && status < 600)
    );
  }
  // Retry sur les erreurs réseau (TypeError avec fetch)
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return true;
  }
  // Ne pas retry sur les autres erreurs
  return false;
}

/**
 * Wrapper autour de fetch avec gestion d'erreurs centralisée et retry automatique optionnel
 *
 * @example
 * ```typescript
 * // Utilisation simple
 * const data = await httpRequest('/api/users', {
 *   method: 'GET',
 *   headers: { Authorization: `Bearer ${token}` }
 * });
 *
 * // Avec retry automatique (3 tentatives par défaut)
 * const data = await httpRequest('/api/users', {
 *   method: 'GET',
 *   retry: true,
 * });
 *
 * // Avec options de retry personnalisées
 * const data = await httpRequest('/api/users', {
 *   method: 'GET',
 *   retry: {
 *     maxRetries: 5,
 *     initialDelay: 500,
 *     backoffFactor: 2,
 *   },
 * });
 *
 * // Avec gestion d'erreur personnalisée
 * try {
 *   const data = await httpRequest('/api/users', {
 *     errorMessage: ERROR_MESSAGES.LOADING_FAILED,
 *   });
 * } catch (error) {
 *   if (error instanceof HttpError) {
 *     console.log('Status:', error.statusCode);
 *   }
 * }
 * ```
 */
export async function httpRequest<T = unknown>(
  url: string,
  options: HttpRequestOptions = {},
): Promise<T> {
  const {
    logErrors = true,
    quietStatuses = [],
    errorMessage,
    timeout = 30000,
    retry: retryOptions,
    ...fetchOptions
  } = options;

  // Fonction interne pour effectuer la requête
  const performRequest = async (): Promise<T> => {
    const controller = new AbortController();
    const timeoutId = timeout
      ? setTimeout(() => controller.abort(), timeout)
      : null;

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      // Clear timeout si la requête réussit
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Gérer les erreurs HTTP
      if (!response.ok) {
        let errorData: HttpErrorData;
        try {
          errorData = (await response.json()) as Record<string, unknown>;
        } catch {
          errorData = await response.text();
        }

        const httpError = httpErrorFromBody(
          response.status,
          response.statusText,
          errorData,
          errorMessage ?? getErrorMessage(response.status),
        );

        // Never the response body (#225): it may carry personal or health
        // data, and these logs reach Sentry with the user's identity. Not
        // the code either: a fine code (MEDICAL_UNFIT) is health data too.
        if (logErrors && !quietStatuses.includes(response.status)) {
          logger.error(`HTTP ${response.status}: ${response.statusText}`, {
            url,
            status: response.status,
            statusText: response.statusText,
          });
        }

        throw httpError;
      }

      // Parser la réponse JSON
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        return (await response.json()) as T;
      }

      return (await response.text()) as T;
    } catch (error) {
      // Clear timeout en cas d'erreur
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Gérer les erreurs d'abort (timeout)
      if (error instanceof Error && error.name === "AbortError") {
        const timeoutError = new HttpError(
          408,
          "Request Timeout",
          null,
          ERROR_MESSAGES.TIMEOUT_ERROR,
        );

        if (logErrors) {
          logger.error("Request timeout", { url, timeout });
        }

        throw timeoutError;
      }

      // Gérer les erreurs réseau
      if (error instanceof TypeError && error.message.includes("fetch")) {
        const networkError = new HttpError(
          0,
          "Network Error",
          null,
          ERROR_MESSAGES.NETWORK_ERROR,
        );

        if (logErrors) {
          logger.error("Network error", { url, error });
        }

        throw networkError;
      }

      // Ré-throw les HttpError
      if (error instanceof HttpError) {
        throw error;
      }

      // Erreur inconnue
      const unknownError = new HttpError(
        500,
        "Unknown Error",
        null,
        errorMessage ?? ERROR_MESSAGES.UNKNOWN_ERROR,
      );

      if (logErrors) {
        logger.error("Unknown error", { url, error });
      }

      throw unknownError;
    }
  };

  // Appliquer le retry si activé
  if (retryOptions) {
    const retryConfig: RetryOptions =
      typeof retryOptions === "boolean"
        ? { shouldRetry: shouldRetryHttpError }
        : {
            ...retryOptions,
            shouldRetry: retryOptions.shouldRetry ?? shouldRetryHttpError,
          };

    return retry(performRequest, retryConfig);
  }

  // Sinon, exécuter directement
  return performRequest();
}

/**
 * Obtient un message d'erreur basé sur le code de statut HTTP
 */
function getErrorMessage(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return "Requête invalide";
    case 401:
      return ERROR_MESSAGES.INVALID_CREDENTIALS;
    case 403:
      return "Accès refusé";
    case 404:
      return "Ressource non trouvée";
    case 408:
      return ERROR_MESSAGES.TIMEOUT_ERROR;
    case 500:
    case 502:
    case 503:
      return ERROR_MESSAGES.SERVER_ERROR;
    default:
      return ERROR_MESSAGES.UNKNOWN_ERROR;
  }
}

/**
 * GET request helper
 */
export function httpGet<T = unknown>(
  url: string,
  options?: Omit<HttpRequestOptions, "method">,
): Promise<T> {
  return httpRequest<T>(url, { ...options, method: "GET" });
}

/**
 * POST request helper
 */
export function httpPost<T = unknown>(
  url: string,
  data?: unknown,
  options?: Omit<HttpRequestOptions, "method" | "body">,
): Promise<T> {
  return httpRequest<T>(url, {
    ...options,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    body: data ? JSON.stringify(data) : undefined,
  });
}

/**
 * PUT request helper
 */
export function httpPut<T = unknown>(
  url: string,
  data?: unknown,
  options?: Omit<HttpRequestOptions, "method" | "body">,
): Promise<T> {
  return httpRequest<T>(url, {
    ...options,
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    body: data ? JSON.stringify(data) : undefined,
  });
}

/**
 * PATCH request helper
 */
export function httpPatch<T = unknown>(
  url: string,
  data?: unknown,
  options?: Omit<HttpRequestOptions, "method" | "body">,
): Promise<T> {
  return httpRequest<T>(url, {
    ...options,
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    body: data ? JSON.stringify(data) : undefined,
  });
}

/**
 * DELETE request helper
 */
export function httpDelete<T = unknown>(
  url: string,
  options?: Omit<HttpRequestOptions, "method">,
): Promise<T> {
  return httpRequest<T>(url, { ...options, method: "DELETE" });
}
