import { useCallback } from "react";
import { BackendService } from "../services/BackendService";

/**
 * Hook utilitaire pour vérifier la santé du backend
 *
 * Encapsule l'appel à BackendService.checkHealth() pour respecter le pattern Repository.
 * Permet de vérifier si le backend est accessible et opérationnel.
 *
 * @returns {Object} Objet contenant la fonction checkHealth
 * @returns {Function} checkHealth - Fonction asynchrone qui retourne true si le backend est accessible, false sinon
 *
 * @example
 * ```typescript
 * const { checkHealth } = useBackendHealth();
 *
 * // Vérifier la santé du backend
 * const isHealthy = await checkHealth();
 * if (!isHealthy) {
 *   console.log('Backend non accessible');
 * }
 * ```
 */
export const useBackendHealth = () => {
  /**
   * Vérifie la santé du backend en effectuant une requête de health check
   *
   * @returns {Promise<boolean>} true si le backend répond correctement, false sinon
   */
  const checkHealth = useCallback(async (): Promise<boolean> => {
    return BackendService.checkHealth();
  }, []);

  return { checkHealth };
};
