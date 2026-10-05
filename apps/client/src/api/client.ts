/**
 * Configures the auto-generated OpenAPI client with the app's base URL and auth.
 *
 * Import this module once at app startup (e.g. in App.tsx or queryClient)
 * before using any generated SDK function.
 */
import { BACKEND_URL } from "../config";
import { client } from "./generated/client.gen";
import { refreshSession } from "./sessionRefresh";
import { getAccessToken } from "./tokenStore";

// BACKEND_URL already includes the /api/v1 prefix (both dev and prod), so the
// generated client uses it as-is. Appending /api/v1 again would double it.
client.setConfig({
  baseUrl: BACKEND_URL,
});

// Inject auth token on every request — from SecureStore via tokenStore, the
// same source as the manual Axios client in services/api.ts.
client.interceptors.request.use(async (request) => {
  const token = await getAccessToken();
  if (token) {
    request.headers.set("Authorization", `Bearer ${token}`);
  }
  return request;
});

// On 401 (expired access token): refresh silently and replay the request once.
// Only safe/idempotent, bodyless requests (GET/HEAD) are auto-retried — those
// are exactly the reads that break when the token expires mid-session. For
// non-idempotent requests we still refresh (so the next call succeeds) but do
// not replay a possibly-consumed body.
client.interceptors.response.use(async (response, request) => {
  if (response.status !== 401 || request.url.includes("/auth/")) {
    return response;
  }

  const newToken = await refreshSession();
  if (!newToken) return response;

  const method = (request.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return response;
  }

  const retried = new Request(request, {});
  retried.headers.set("Authorization", `Bearer ${newToken}`);
  return fetch(retried);
});

export { client };
