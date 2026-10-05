import { useCallback } from "react";
import { Alert } from "react-native";
import { createLogger } from "../utils/logger";

const logger = createLogger("useErrorHandler");

export interface ErrorHandlerOptions {
  /**
   * Message d'erreur personnalisé à afficher à l'utilisateur
   */
  userMessage?: string;
  /**
   * Si true, log l'erreur dans la console
   */
  logError?: boolean;
  /**
   * Si true, affiche une alerte à l'utilisateur
   */
  showAlert?: boolean;
  /**
   * Callback appelé en cas d'erreur
   */
  onError?: (error: Error) => void;
}

/**
 * Hook utilitaire pour gérer les erreurs de manière cohérente
 *
 * @example
 * ```typescript
 * const { handleError, withErrorHandling } = useErrorHandler();
 *
 * // Utilisation simple
 * try {
 *   await someAsyncOperation();
 * } catch (error) {
 *   handleError(error, {
 *     userMessage: "L'opération a échoué",
 *     showAlert: true,
 *   });
 * }
 *
 * // Utilisation avec wrapper
 * const handleAction = withErrorHandling(
 *   async () => {
 *     await someAsyncOperation();
 *   },
 *   {
 *     userMessage: "L'opération a échoué",
 *     showAlert: true,
 *   }
 * );
 * ```
 */
export const useErrorHandler = () => {
  const handleError = useCallback(
    (error: unknown, options: ErrorHandlerOptions = {}) => {
      const {
        userMessage,
        logError = true,
        showAlert = false,
        onError,
      } = options;

      const errorObj =
        error instanceof Error ? error : new Error(String(error));

      // Log l'erreur
      if (logError) {
        logger.error(userMessage ?? "Une erreur est survenue", errorObj);
      }

      // Affiche une alerte si demandé
      if (showAlert) {
        Alert.alert("Erreur", userMessage ?? errorObj.message);
      }

      // Appelle le callback personnalisé
      if (onError) {
        onError(errorObj);
      }
    },
    [],
  );

  /**
   * Wrapper pour exécuter une fonction asynchrone avec gestion automatique des erreurs
   */
  const withErrorHandling = useCallback(
    async <T>(
      fn: () => Promise<T>,
      options: ErrorHandlerOptions = {},
    ): Promise<T | null> => {
      try {
        return await fn();
      } catch (error) {
        handleError(error, options);
        return null;
      }
    },
    [handleError],
  );

  /**
   * Combine la gestion d'erreur avec le loading state
   */
  const withLoadingAndErrorHandling = useCallback(
    async <T>(
      fn: () => Promise<T>,
      setLoading: (loading: boolean) => void,
      options: ErrorHandlerOptions = {},
    ): Promise<T | null> => {
      setLoading(true);
      try {
        return await fn();
      } catch (error) {
        handleError(error, options);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [handleError],
  );

  return {
    handleError,
    withErrorHandling,
    withLoadingAndErrorHandling,
  };
};
