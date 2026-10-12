/**
 * HelloAsso API hosts (#404), verified against the sandbox: the token
 * endpoint is `{host}/oauth2/token` and the API is versioned `{host}/v5/…`.
 * Production is the default; staging may point at the sandbox. This list is
 * closed (env validation): club credentials are only ever sent to HelloAsso.
 */
export const HELLOASSO_API_URLS = [
  "https://api.helloasso.com",
  "https://api.helloasso-sandbox.com",
] as const;

export const DEFAULT_HELLOASSO_API_URL = HELLOASSO_API_URLS[0];
