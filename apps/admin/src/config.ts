/** Backend base URL, `/api/v1` included. Set at build time. */
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';
