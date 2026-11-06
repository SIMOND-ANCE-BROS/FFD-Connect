import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSessionGeneration } from "../../api/tokenStore";
import { CguApi } from "../../services/api/cgu-api";
import { createLogger } from "../../utils/logger";

const logger = createLogger("cguConsent");

/**
 * Consentement aux CGU (#424) — persisté par VERSION : incrémenter
 * CGU_VERSION lors d'un changement substantiel des conditions re-déclenche
 * la demande d'acceptation au prochain lancement.
 */
// v2 (#270) : vérification du certificat médical par une personne (CGU §5).
// v3 (#61) : comptes de mineurs ouverts avec l'accord d'un représentant légal
// (CGU §6).
// v4 (#928) : acceptation explicite par compte, enregistrée sur le compte
// (version et date), au lieu de « la poursuite de l'utilisation vaut acceptation ».
// Doit rester égale à CGU_VERSION côté backend (src/cgu/cgu-version.ts),
// incrémentée côté backend AVANT de livrer l'app avec le nouveau texte.
export const CGU_VERSION = "4";

/**
 * Qui accepte (#894). Le consentement est PAR COMPTE : il est enregistré sur
 * le serveur, et l'appareil n'en garde qu'une copie propre à chaque compte,
 * relue seulement quand le serveur ne répond pas (hors ligne, réveil, ancien
 * backend, compte de review). Un invité, sans compte, garde l'acceptation de
 * l'appareil (clé historique, #424).
 */
export type CguSubject = { kind: "guest" } | { kind: "account"; id: string };

/** Clé historique (#424) : acceptation de l'appareil, réservée aux invités. */
const GUEST_KEY = "cgu_accepted_version";
const ACCOUNT_KEY_PREFIX = "cgu_accepted_version:account:";

const storageKey = (subject: CguSubject) =>
  subject.kind === "guest" ? GUEST_KEY : `${ACCOUNT_KEY_PREFIX}${subject.id}`;

async function acceptedLocally(subject: CguSubject): Promise<boolean | null> {
  try {
    return (await AsyncStorage.getItem(storageKey(subject))) === CGU_VERSION;
  } catch {
    return null; // Stockage illisible.
  }
}

async function rememberLocally(subject: CguSubject): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(subject), CGU_VERSION);
  } catch {
    // Best-effort : au pire la modale réapparaîtra au prochain lancement.
  }
}

async function forgetLocally(subject: CguSubject): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(subject));
  } catch {
    // Best-effort.
  }
}

/**
 * Retire la copie locale de l'acceptation d'un compte (#930) : appelé quand le
 * compte est supprimé, pour que son identifiant ne reste pas sur l'appareil.
 * Conservée à la déconnexion : c'est le repli hors ligne de ce compte à sa
 * prochaine connexion. Ne rejette jamais.
 */
export async function forgetCguAcceptance(accountId: string): Promise<void> {
  await forgetLocally({ kind: "account", id: accountId });
}

/**
 * Envoie au compte une acceptation donnée sur l'appareil. Si le serveur est
 * sur une autre version des CGU que le texte montré (409), rien n'est
 * enregistré : la copie locale est oubliée pour que la question revienne,
 * plutôt que de croire le consentement acquis.
 */
async function sendToAccount(
  subject: CguSubject,
): Promise<"saved" | "stale" | "failed"> {
  const result = await CguApi.accept(CGU_VERSION);
  if (result === "stale") {
    await forgetLocally(subject);
    logger.warn("CGU version differs from the backend's; asked again");
  } else if (result === "failed") {
    logger.warn("CGU acceptance not saved on the account; resent later");
  }
  return result;
}

/**
 * Faut-il demander l'acceptation de la version courante des CGU ?
 *
 * Compte : le serveur fait foi. S'il ne répond pas, la copie locale de CE
 * compte décide. Si le serveur ignore une acceptation que ce compte a donnée
 * sur cet appareil (envoi échoué hors ligne), elle lui est renvoyée — jamais
 * si l'identité de la session a changé depuis `generation` (#893) : le jeton
 * courant serait celui d'un autre compte.
 */
export async function needsCguAcceptance(
  subject: CguSubject,
  generation: number = getSessionGeneration(),
): Promise<boolean> {
  const local = await acceptedLocally(subject);
  if (subject.kind === "guest") {
    // Stockage illisible : ne pas bloquer l'app, on redemandera plus tard.
    return local === false;
  }
  const server = await CguApi.hasAccepted(CGU_VERSION);
  if (server === true) {
    if (local === false) await rememberLocally(subject);
    return false;
  }
  if (server === false) {
    if (local !== true) return true;
    // Identity moved on: the next session runs its own check.
    if (getSessionGeneration() !== generation) return false;
    return (await sendToAccount(subject)) === "stale";
  }
  return local === false;
}

/**
 * Enregistre l'acceptation de la version courante des CGU : sur l'appareil
 * (repli hors ligne), puis — sans l'attendre — sur le compte. Un envoi échoué
 * est renvoyé au prochain lancement (needsCguAcceptance). Ne rejette jamais.
 */
export async function acceptCgu(subject: CguSubject): Promise<void> {
  await rememberLocally(subject);
  if (subject.kind === "account") void sendToAccount(subject);
}
