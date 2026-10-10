import { AppState } from "react-native";
import {
  HEALTH_URL,
  STATIC_BASE_URL,
  WAKE_ENABLED,
  WAKE_KEY,
  WAKE_URL,
} from "../config";
import { useWakeStore } from "../stores/wake.store";
import { isDeviceOffline } from "./connectivity";
import { createLogger } from "./logger";

const logger = createLogger("BackendWake");

// Le backend est un Container App en minReplicas=0 : le réveil (image pull +
// migrations + boot NestJS) prend en général 30-90s. Azure retient la requête
// pendant le scale-from-zero, donc le premier poll répond souvent dès que
// l'app est prête — un intervalle court raccourcit surtout le cas 502 (ingress
// debout, conteneur pas encore prêt).
const WAKE_POLL_INTERVAL_MS = 3000;
const WAKE_MAX_WAIT_MS = 150000; // ~2.5 min (boot ~90s + marge)
/** Sonde initiale du pré-réveil : au-delà, on considère le backend endormi. */
const WARM_PROBE_TIMEOUT_MS = 4000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Vraie implémentation de fetch, capturée avant tout wrapping. Utilisée en
 * interne pour le réveil + le polling /health sans repasser par l'intercepteur.
 */
let realFetch: typeof fetch | null = null;

/** Promesse de réveil partagée : dédoublonne les réveils concurrents. */
let wakePromise: Promise<boolean> | null = null;

/** Indique si une requête cible le backend (et n'est pas l'infra de réveil). */
function isBackendRequest(url: string): boolean {
  if (!STATIC_BASE_URL || !url.startsWith(STATIC_BASE_URL)) return false;
  if (WAKE_URL && url.startsWith(WAKE_URL)) return false;
  if (HEALTH_URL && url.startsWith(HEALTH_URL)) return false;
  return true;
}

function isBackendDownStatus(status: number): boolean {
  // Ingress debout mais conteneur backend KO, ou passerelle injoignable.
  return status === 502 || status === 503 || status === 504;
}

/**
 * Déclenche le réveil du Container App puis attend que /health réponde 200.
 * Idempotent : les appels concurrents partagent la même promesse. Un réveil
 * `silent` (pré-réveil au lancement) n'affiche pas l'overlay ; si une vraie
 * requête utilisateur échoue pendant ce réveil, elle rejoint la même promesse
 * et rend l'overlay visible (compteur déjà entamé).
 * Retourne true si le backend est prêt, false sinon (timeout).
 * Returns false immediately, without overlay, when NetInfo confirms the
 * device is offline.
 */
async function ensureBackendAwake(opts?: {
  silent?: boolean;
}): Promise<boolean> {
  if (!WAKE_ENABLED || !HEALTH_URL) return false;
  // No network on the device (gym without signal, airplane mode): the failure
  // is not a sleeping backend. No overlay, no /health polling — return at once
  // so the caller fails with its normal network error (React Query / offline
  // cache take over, and its reconnect refetch is enough: no retry here).
  if (await isDeviceOffline()) {
    logger.info("Device offline — skipping backend wake");
    return false;
  }
  if (wakePromise) {
    // Un appelant non-silencieux attend derrière un réveil déjà en cours :
    // l'utilisateur est bloqué, on montre l'overlay.
    if (!opts?.silent) useWakeStore.getState().setVisible(true);
    return wakePromise;
  }
  const doFetch = realFetch ?? fetch;

  wakePromise = (async () => {
    const store = useWakeStore.getState();
    store.setWaking(true);
    store.setVisible(!opts?.silent);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      useWakeStore
        .getState()
        .setElapsed(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);

    try {
      if (WAKE_URL) {
        try {
          await doFetch(WAKE_URL, {
            method: "POST",
            headers: WAKE_KEY ? { "X-Wake-Key": WAKE_KEY } : undefined,
          });
          logger.info("Wake requested");
        } catch (e) {
          logger.warn("Wake request failed (continuing to poll)", e);
        }
      }

      const deadline = Date.now() + WAKE_MAX_WAIT_MS;
      while (Date.now() < deadline) {
        try {
          const r = await doFetch(HEALTH_URL, { method: "GET" });
          if (r.ok) {
            logger.info("Backend healthy again");
            return true;
          }
        } catch {
          /* still down, keep polling */
        }
        await sleep(WAKE_POLL_INTERVAL_MS);
      }
      logger.warn("Backend did not come up within the wait window");
      return false;
    } finally {
      clearInterval(timer);
      useWakeStore.getState().setWaking(false);
      wakePromise = null;
    }
  })();

  return wakePromise;
}

/**
 * Réveille le backend et attend qu'il soit prêt (overlay visible par défaut).
 * Point d'entrée pour la couche axios (services/api.ts) : sur erreur réseau ou
 * 502/503/504, réveiller puis rejouer la requête. Retourne false immédiatement
 * quand le réveil est désactivé (dev) — l'appelant retombe sur son propre
 * traitement d'erreur.
 */
export function wakeBackend(opts?: { silent?: boolean }): Promise<boolean> {
  return ensureBackendAwake(opts);
}

/**
 * Pré-réveil au lancement de l'app : sonde /health et, si le backend est
 * endormi, déclenche un réveil silencieux (sans overlay) pendant que
 * l'utilisateur est sur le splash/login. Le temps qu'il fasse sa première
 * action, le backend est déjà debout — ou le réveil est bien entamé.
 * No-op quand le réveil est désactivé (WAKE_ENABLED=false, ex. en dev).
 */
export async function warmBackend(): Promise<void> {
  if (!WAKE_ENABLED || !HEALTH_URL) return;
  // A data-only push can launch the app in the BACKGROUND (#775). The JS
  // bundle loads, so this pre-warm would fire and wake a scale-to-zero
  // Container App for a user who is not even looking at their phone — a cold
  // start billed for nothing. Only "background" is skipped: during a normal
  // cold launch AppState may still be "inactive" or unknown at module time,
  // and we must not lose the pre-warm there.
  if (AppState.currentState === "background") {
    logger.info("Launched in background — skipping pre-warm");
    return;
  }
  // Offline at launch: no probe, no wake. Not retried when the network comes
  // back — the first real request wakes the backend if it is still asleep.
  if (await isDeviceOffline()) {
    logger.info("Device offline — skipping pre-warm");
    return;
  }
  if (wakePromise) {
    await wakePromise;
    return;
  }
  const doFetch = realFetch ?? fetch;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WARM_PROBE_TIMEOUT_MS);
    try {
      const r = await doFetch(HEALTH_URL, {
        method: "GET",
        signal: controller.signal,
      });
      if (r.ok) {
        logger.info("Backend already warm");
        return;
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    /* endormi ou réseau coupé — on tente le réveil */
  }
  await ensureBackendAwake({ silent: true });
}

/**
 * The `fetch` that never goes through the wake wrapper. For requests that must
 * NEVER wake the scale-to-zero backend nor show the overlay (anonymous usage
 * batches, lot 5).
 */
export function rawFetch(): typeof fetch {
  return realFetch ?? fetch;
}

/**
 * Installe (une seule fois) un wrapper global de `fetch` qui, sur échec d'une
 * requête vers le backend (erreur réseau ou 502/503/504), réveille le
 * Container App, patiente jusqu'à /health 200, puis rejoue la requête une
 * fois. No-op quand le réveil est désactivé (WAKE_ENABLED=false, ex. en dev).
 */
export function installBackendWake(): void {
  if (!WAKE_ENABLED || !HEALTH_URL) return;
  const g = globalThis as { fetch: typeof fetch; __ffdWakeInstalled?: boolean };
  if (g.__ffdWakeInstalled) return;

  realFetch = g.fetch.bind(globalThis);
  const original = realFetch;

  g.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (!isBackendRequest(url)) {
      return original(input, init);
    }

    try {
      const res = await original(input, init);
      if (isBackendDownStatus(res.status)) {
        const ready = await ensureBackendAwake();
        if (ready) return original(input, init);
      }
      return res;
    } catch (err) {
      // Une annulation demandée par l'appelant (AbortController) n'est PAS un
      // signe que le backend dort : la réveiller afficherait l'overlay pour une
      // requête qu'on vient soi-même d'abandonner, et paierait un cold start
      // pour rien. Cf. le désenregistrement de token borné au logout.
      if (err instanceof Error && err.name === "AbortError") throw err;
      // Erreur réseau pure (app endormie → connexion refusée / timeout).
      const ready = await ensureBackendAwake();
      if (ready) return original(input, init);
      throw err;
    }
  };

  g.__ffdWakeInstalled = true;
  logger.info("Backend auto-wake installed");
}
