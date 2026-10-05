/**
 * Format standard des réponses d'erreur de l'API FFD Connect.
 * Aligné sur HttpExceptionFilter (backend).
 */
export interface ApiErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  method: string;
  message: string | string[];
}
