import { useCallback, useState } from "react";

/**
 * Hook utilitaire pour gérer l'état de chargement
 *
 * @example
 * ```typescript
 * const { isLoading, startLoading, stopLoading, withLoading } = useLoadingState();
 *
 * // Utilisation simple
 * const handleAction = async () => {
 *   startLoading();
 *   try {
 *     await someAsyncOperation();
 *   } finally {
 *     stopLoading();
 *   }
 * };
 *
 * // Utilisation avec wrapper
 * const handleAction = withLoading(async () => {
 *   await someAsyncOperation();
 * });
 * ```
 */
export const useLoadingState = (initialState = false) => {
  const [isLoading, setIsLoading] = useState(initialState);

  const startLoading = useCallback(() => {
    setIsLoading(true);
  }, []);

  const stopLoading = useCallback(() => {
    setIsLoading(false);
  }, []);

  /**
   * Wrapper pour exécuter une fonction asynchrone avec gestion automatique du loading
   */
  const withLoading = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T> => {
      setIsLoading(true);
      try {
        return await fn();
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return {
    isLoading,
    startLoading,
    stopLoading,
    withLoading,
  };
};
