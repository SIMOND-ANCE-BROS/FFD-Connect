/**
 * Origines CORS pour les WebSockets.
 *
 * Lit process.env directement (exception à la convention ConfigService) car le
 * décorateur @WebSocketGateway est évalué au chargement du module, avant que
 * l'injection de dépendances ne soit disponible. La validation de CORS_ORIGINS
 * reste assurée au démarrage par env.validation.ts.
 */
export function getWebSocketCorsOrigins(): string[] {
  return process.env.CORS_ORIGINS?.split(",") ?? ["http://localhost:8081"];
}
