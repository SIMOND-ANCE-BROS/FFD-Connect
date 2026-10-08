/**
 * Global route prefix of the HTTP API (health and the uploads fallback are
 * excluded, see main.ts). Shared so code that builds absolute API URLs (e.g.
 * the Wallet pass download link) cannot drift from the real prefix.
 */
export const API_GLOBAL_PREFIX = "api/v1";
