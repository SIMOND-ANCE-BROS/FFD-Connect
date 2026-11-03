import AsyncStorage from "@react-native-async-storage/async-storage";
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
// (CGU §6). Doit rester égale à CGU_VERSION côté backend (src/cgu/cgu-version.ts).
export const CGU_VERSION = "3";

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

/**
 * Faut-il demander l'acceptation de la version courante des CGU ?
 *
 * Compte : le serveur fait foi. S'il ne répond pas, la copie locale de CE
 * compte décide. Si le serveur ignore une acceptation que ce compte a donnée
 * sur cet appareil (envoi échoué hors ligne), elle lui est renvoyée.
 */
export async function needsCguAcceptance(
  subject: CguSubject,
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
    if (!(await CguApi.accept(CGU_VERSION))) {
      logger.warn("CGU acceptance resync failed; retried at next launch");
    }
    return false;
  }
  return local === false;
}

/**
 * Enregistre l'acceptation de la version courante des CGU : sur l'appareil
 * d'abord (repli hors ligne), puis sur le compte. Un envoi échoué est
 * renvoyé au prochain lancement (needsCguAcceptance). Ne rejette jamais.
 */
export async function acceptCgu(subject: CguSubject): Promise<void> {
  await rememberLocally(subject);
  if (subject.kind === "account" && !(await CguApi.accept(CGU_VERSION))) {
    logger.warn("CGU acceptance not saved on the account; retried later");
  }
}
