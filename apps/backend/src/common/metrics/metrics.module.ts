import { Module } from "@nestjs/common";
import { MetricsService } from "./metrics.service";

/**
 * Module de métriques de performance (APM)
 *
 * Fournit un système de métriques pour surveiller les performances de l'application:
 * - Temps de réponse des endpoints
 * - Utilisation de la mémoire
 * - Nombre de requêtes par endpoint
 * - Taux d'erreur
 * - Métriques de base de données
 */
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
