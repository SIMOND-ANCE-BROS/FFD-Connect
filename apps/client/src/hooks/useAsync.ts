import { useCallback, useEffect, useRef, useState } from "react";

/**
 * État d'une opération asynchrone
 */
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Options pour le hook useAsync
 */
export interface UseAsyncOptions<T> {
  /**
   * Si true, réinitialise l'état avant chaque exécution
   */
  resetOnExecute?: boolean;
  /**
   * Callback appelé en cas de succès
   */
  onSuccess?: (data: T) => void;
  /**
   * Callback appelé en cas d'erreur
   */
  onError?: (error: Error) => void;
}

/**
 * Hook utilitaire pour gérer les opérations asynchrones
 *
 * Fournit un état unifié (data, loading, error) et une fonction execute pour déclencher l'opération.
 *
 * @example
 * ```typescript
 * const { data, loading, error, execute } = useAsync(async () => {
 *   const response = await fetch('/api/data');
 *   return response.json();
 * });
 *
 * // Dans un useEffect ou handler
 * useEffect(() => {
 *   execute();
 * }, []);
 *
 * // Avec options
 * const { data, loading, error, execute } = useAsync(
 *   async () => fetchData(),
 *   {
 *     onSuccess: (data) => console.log('Success:', data),
 *     onError: (error) => console.error('Error:', error),
 *   }
 * );
 * ```
 */
export function useAsync<T, P extends unknown[] = []>(
  asyncFunction: (...args: P) => Promise<T>,
  options: UseAsyncOptions<T> = {},
): AsyncState<T> & { execute: (...args: P) => Promise<T | null> } {
  const { resetOnExecute = false, onSuccess, onError } = options;

  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const isMounted = useRef(false);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const execute = useCallback(
    async (...args: P): Promise<T | null> => {
      if (resetOnExecute) {
        setState({ data: null, loading: true, error: null });
      } else {
        setState((prev) => ({ ...prev, loading: true, error: null }));
      }

      try {
        const data = await asyncFunction(...args);
        if (isMounted.current) {
          setState({ data, loading: false, error: null });
          if (onSuccess) onSuccess(data);
        }
        return data;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (isMounted.current) {
          setState({ data: null, loading: false, error: err });
          if (onError) onError(err);
        }
        return null;
      }
    },
    [asyncFunction, resetOnExecute, onSuccess, onError],
  );

  return {
    ...state,
    execute,
  };
}
