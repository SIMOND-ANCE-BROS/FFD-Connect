import { createLogger } from "../utils/logger";

const logger = createLogger("SessionCleanup");

type Cleanup = () => Promise<void> | void;

const cleanups = new Set<Cleanup>();

/**
 * Enregistre une purge à exécuter à la déconnexion (cache serveur persisté,
 * etc.). Registre plutôt qu'import direct : `AuthService` n'a pas à connaître
 * le QueryClient (et éviter un cycle d'imports). Renvoie le désabonnement.
 */
export function onSessionEnd(cleanup: Cleanup): () => void {
  cleanups.add(cleanup);
  return () => {
    cleanups.delete(cleanup);
  };
}

/**
 * Exécute toutes les purges. Une purge en échec n'empêche pas les autres ni
 * la déconnexion elle-même.
 */
export async function runSessionEndCleanups(): Promise<void> {
  await Promise.all(
    [...cleanups].map(async (cleanup) => {
      try {
        await cleanup();
      } catch (error) {
        logger.warn("Session cleanup failed", error);
      }
    }),
  );
}
