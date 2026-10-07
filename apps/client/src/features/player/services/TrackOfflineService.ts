import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  deleteAsync,
  documentDirectory,
  downloadAsync,
  getInfoAsync,
  moveAsync,
} from "expo-file-system/legacy";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("TrackOfflineService");

/**
 * Musique hors-ligne (#416) — politique « favoris téléchargés » :
 * la collection entière est STREAMÉE (aucun stockage), seuls les favoris
 * (likedTrackIds) sont téléchargés localement pour l'entraînement sans
 * réseau. Retirer un favori supprime sa copie locale (stockage maîtrisé).
 *
 * Registre AsyncStorage : on ne supprime QUE les fichiers que ce service a
 * téléchargés. Les pistes importées (AddTrackModal, même dossier) ne sont
 * jamais touchées.
 */

const REGISTRY_KEY = "offline_favorite_files_v1";

/** Chemin local d'une piste (même emplacement que les imports AddTrackModal). */
export function localTrackUri(filename: string): string {
  return `${documentDirectory ?? ""}${filename}`;
}

async function loadRegistry(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(REGISTRY_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

async function saveRegistry(files: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(REGISTRY_KEY, JSON.stringify(files));
  } catch {
    // Best-effort — au pire un fichier orphelin restera sur le disque.
  }
}

/** Fichiers réellement présents sur le disque parmi `filenames`. */
export async function getDownloadedSet(
  filenames: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  await Promise.all(
    filenames.map(async (filename) => {
      try {
        const info = await getInfoAsync(localTrackUri(filename));
        if (info.exists) found.add(filename);
      } catch {
        /* illisible = absent */
      }
    }),
  );
  return found;
}

/**
 * Télécharge `remoteUrl` vers `localUri` (expo-file-system downloadAsync).
 *
 * Le téléchargement écrit d'abord un fichier temporaire `.part` au nom
 * unique, déplacé sur `localUri` seulement une fois complet (HTTP 200) : un
 * fichier présent à `localUri` est donc toujours entier (une coupure réseau
 * ne laisse jamais de fichier tronqué « en cache »), et deux téléchargements
 * concurrents du même fichier (arrêt puis relance immédiate) ne s'écrasent
 * pas. Le `.part` est purgé en cas d'erreur.
 *
 * Retourne true si le fichier est en place, false sur une réponse d'erreur.
 * Lève si le réseau échoue.
 */
export async function downloadToFile(
  remoteUrl: string,
  localUri: string,
): Promise<boolean> {
  const partUri = `${localUri}.${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}.part`;
  try {
    const result = await downloadAsync(remoteUrl, partUri);
    if (result.status !== 200) {
      await deleteAsync(partUri, { idempotent: true });
      return false;
    }
    await deleteAsync(localUri, { idempotent: true });
    await moveAsync({ from: partUri, to: localUri });
    return true;
  } catch (e) {
    await deleteAsync(partUri, { idempotent: true }).catch(() => {});
    throw e;
  }
}

export interface SyncableTrack {
  filename: string;
  remoteUrl: string;
  liked: boolean;
}

/**
 * Réconcilie les copies locales avec les favoris (à appeler quand le réseau
 * est disponible) :
 * - favori sans copie locale → téléchargement (enregistré au registre)
 * - fichier du registre dont la piste n'est plus favorite → suppression
 * Retourne l'ensemble des fichiers présents localement après synchro.
 */
export async function syncFavoriteDownloads(
  tracks: SyncableTrack[],
): Promise<Set<string>> {
  const registry = new Set(await loadRegistry());
  const likedFilenames = new Set(
    tracks.filter((t) => t.liked).map((t) => t.filename),
  );

  // 1. Supprime les fichiers téléchargés par CE service et plus favoris.
  for (const filename of [...registry]) {
    if (!likedFilenames.has(filename)) {
      try {
        await deleteAsync(localTrackUri(filename), { idempotent: true });
      } catch {
        /* déjà absent */
      }
      registry.delete(filename);
    }
  }

  // 2. Télécharge les favoris manquants.
  for (const track of tracks) {
    if (!track.liked || !track.remoteUrl) continue;
    const uri = localTrackUri(track.filename);
    try {
      const info = await getInfoAsync(uri);
      if (!info.exists) {
        // Réponse d'erreur → purgée par downloadToFile, retentée plus tard.
        if (!(await downloadToFile(track.remoteUrl, uri))) continue;
        registry.add(track.filename);
      } else if (!registry.has(track.filename)) {
        // Déjà présent (ex. import) — le favori s'appuie dessus sans le
        // revendiquer : il ne sera pas supprimé au retrait du favori.
      }
    } catch (e) {
      logger.warn("Favorite download failed (will retry on next sync)", {
        filename: track.filename,
        error: e,
      });
    }
  }

  await saveRegistry([...registry]);
  return getDownloadedSet(tracks.map((t) => t.filename));
}
