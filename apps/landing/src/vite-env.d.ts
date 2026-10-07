/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_URL?: string;
  readonly VITE_GITHUB_REPO?: string;
  /** Backend API base, e.g. https://api-staging.ffd.gabin-simond.fr/api/v1 */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
