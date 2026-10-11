import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import {
  API_RETRY_INITIAL_DELAY_MS,
  API_RETRY_MAX_RETRIES,
  API_TIMEOUT_MS,
  API_URL,
} from "../config";
import { createLogger } from "../utils/logger";
import { retryAxios } from "../utils/retry";
import { wakeBackend } from "../utils/backendWake";
import { usage } from "./analytics/usage";
import { refreshSession } from "../api/sessionRefresh";
import { getAccessToken } from "../api/tokenStore";

const logger = createLogger("api");

const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: API_TIMEOUT_MS,
});

// Request Interceptor — never log auth_config, authToken, or Authorization header values.
api.interceptors.request.use(
  async (config) => {
    // Don't log report requests to avoid noise/cycles
    if (!config.url?.includes("/reports")) {
      try {
        logger.info(
          `API Request: ${config.method?.toUpperCase()} ${config.url}`,
        );
      } catch {
        // Fallback if logger is not available
      }
    }

    // Inject Auth Token (from SecureStore via tokenStore)
    try {
      const token = await getAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      logger.error("Error retrieving auth token", error);
    }

    return config;
  },
  (error) => {
    logger.error(
      "API Request Error",
      error instanceof Error ? error : new Error(String(error)),
    );
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    return Promise.reject(error);
  },
);

// Response Interceptor avec retry automatique pour les erreurs réseau
api.interceptors.response.use(
  (response) => {
    if (!response.config.url?.includes("/reports"))
      try {
        logger.info(`API Response: ${response.status} ${response.config.url}`);
      } catch {
        // Ignore logger errors
      }
    // Lot 5: a successful response proves the backend is awake — the only
    // moment anonymous usage batches may be sent.
    usage.onApiSuccess();
    return response;
  },
  async (error: AxiosError) => {
    const status = error.response ? error.response.status : "Network Error";
    const url = error.config ? error.config.url : "Unknown URL";
    const config = error.config as AxiosRequestConfig & {
      _retry?: boolean;
      _wakeRetry?: boolean;
    };

    // Backend endormi (scale-to-zero) : erreur réseau ou 502/503/504. Axios
    // passe par XHR sur React Native — le wrapper fetch de backendWake ne le
    // couvre pas, et le retry ci-dessous (~3 s) abandonnerait bien avant la
    // fin d'un réveil (~60-120 s). On réveille (overlay + polling /health)
    // puis on rejoue UNE fois. No-op immédiat quand le réveil est désactivé.
    const wakeStatus = error.response?.status;
    const backendMaybeAsleep =
      !error.response ||
      wakeStatus === 502 ||
      wakeStatus === 503 ||
      wakeStatus === 504;
    if (backendMaybeAsleep && !config._wakeRetry) {
      config._wakeRetry = true;
      const ready = await wakeBackend();
      if (ready) {
        logger.info(`Backend réveillé — replay de ${url}`);
        return api.request(config);
      }
    }

    // Gérer les erreurs 401 (Unauthorized) — access token expiré.
    // Refresh silencieux + un seul retry. La session n'est terminée (par
    // sessionRefresh) que si le refresh token est lui-même invalide/expiré.
    if (error.response?.status === 401) {
      const isAuthEndpoint =
        !!url &&
        [
          "/auth/login",
          "/auth/register",
          "/auth/refresh",
          "/auth/forgot-password",
        ].some((p) => url.includes(p));

      if (!isAuthEndpoint && !config._retry) {
        config._retry = true;
        const newToken = await refreshSession();
        if (newToken) {
          config.headers = {
            ...(config.headers ?? {}),
            Authorization: `Bearer ${newToken}`,
          };
          return api.request(config);
        }
        logger.info("Refresh échoué — session terminée");
      }

      // Refresh impossible (ou endpoint d'auth) → rejeter sans retry.
      return Promise.reject(error);
    }

    // Ne pas retry si déjà tenté ou si c'est une erreur 4xx (sauf 408, 429)
    if (
      config._retry ||
      (error.response?.status &&
        error.response.status >= 400 &&
        error.response.status < 500 &&
        error.response.status !== 408 &&
        error.response.status !== 429)
    ) {
      logger.error(
        `API Error: ${status} on ${url}`,
        error instanceof Error ? error : undefined,
        { status, url },
      );
      return Promise.reject(error);
    }

    // Retry automatique pour les erreurs réseau et 5xx
    if (
      !error.response ||
      (error.response.status >= 500 && error.response.status < 600) ||
      error.response.status === 408 ||
      error.response.status === 429
    ) {
      // Gérer les erreurs réseau (pas de response)
      if (!error.response) {
        logger.error(
          `API Error (retry): Network Error on ${url}`,
          error instanceof Error ? error : undefined,
          { url },
        );
        config._retry = true;

        try {
          return await retryAxios(() => api.request(config), {
            maxRetries: API_RETRY_MAX_RETRIES,
            initialDelay: API_RETRY_INITIAL_DELAY_MS,
          });
        } catch (retryError) {
          logger.error(
            `API Error (after retry): Network Error on ${url}`,
            retryError instanceof Error ? retryError : undefined,
            { url },
          );
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          return Promise.reject(retryError);
        }
      }
      // Erreurs serveur 5xx, 408, 429
      logger.error(
        "API Error (retry)",
        error instanceof Error ? error : undefined,
        {
          url: error.config?.url,
          status: error.response.status,
        },
      );
      config._retry = true;

      try {
        return await retryAxios(() => api.request(config), {
          maxRetries: API_RETRY_MAX_RETRIES,
          initialDelay: API_RETRY_INITIAL_DELAY_MS,
        });
      } catch (retryError) {
        logger.error(
          `API Error (after retry): ${status} on ${url}`,
          retryError instanceof Error ? retryError : undefined,
          { url },
        );
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject(retryError);
      }
    }

    logger.error(
      `API Error: ${status} on ${url}`,
      error instanceof Error ? error : undefined,
      { status, url },
    );
    return Promise.reject(error);
  },
);

export default api;
