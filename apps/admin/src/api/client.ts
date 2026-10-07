/**
 * Configures the generated OpenAPI client with the base URL and admin auth.
 * Imported once at startup (App.tsx) before any SDK call.
 */
import { API_URL } from '../config';
import { refreshSession } from '../session/refresh';
import { useSession } from '../session/sessionStore';
import { client } from './generated/client.gen';

// API_URL already includes /api/v1; the exported swagger paths do not.
client.setConfig({ baseUrl: API_URL });

client.interceptors.request.use((request) => {
  const token = useSession.getState().accessToken;
  if (token) request.headers.set('Authorization', `Bearer ${token}`);
  return request;
});

// 401 → refresh once; replay only bodyless reads. A rejected refresh token
// (401/403) clears the session, and RequireAdmin then redirects to /login; an
// unreachable or cold backend keeps it.
client.interceptors.response.use(async (response, request) => {
  if (response.status !== 401 || request.url.includes('/auth/')) {
    return response;
  }
  const token = await refreshSession();
  if (!token) return response;
  const method = (request.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return response;
  const retried = new Request(request, {});
  retried.headers.set('Authorization', `Bearer ${token}`);
  return fetch(retried);
});

export { client };
