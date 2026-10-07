/** Backend base URL, `/api/v1` included. Set at build time. */
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

/** The backend origin: `/health` is served outside the `/api/v1` prefix. */
export function apiOrigin(apiUrl: string): string {
  return apiUrl.replace(/\/api\/v\d+\/?$/, '');
}

/** Same derivation as the mobile app's HEALTH_URL (apps/client/src/config.ts). */
export const API_ORIGIN: string = apiOrigin(API_URL);
