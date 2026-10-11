import { tracksControllerFindAmbiance } from "../../api/generated";
import { getAccessToken } from "../../api/tokenStore";
import type { Track } from "../../features/player/services/TrackRepository";
import { BACKEND_URL } from "../../config";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import { httpDelete, httpGet, httpPatch } from "../../utils/httpInterceptor";

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export const TrackApi = {
  /**
   * Pistes « Ambiance » (musique de pause du mode compétition). Exclues de
   * GET /tracks, servies par GET /tracks/ambiance (client OpenAPI généré) avec
   * la même forme d'item, ramenée ici au type `Track` de la bibliothèque.
   */
  async getAmbianceTracks(): Promise<Track[]> {
    const { data, error } = await tracksControllerFindAmbiance();
    if (error) {
      throw new Error(ERROR_MESSAGES.LOADING_FAILED);
    }
    return data.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      filename: t.filename,
      bpm: t.bpm,
      style: t.style ?? undefined,
      artwork: t.artwork ?? undefined,
      titleMasked: t.titleMasked,
      clashTimecodes: t.clashTimecodes,
    }));
  },

  async getTrack(trackId: string): Promise<{
    id: string;
    title: string;
    artist: string;
    bpm: number;
    rawBpm?: number;
    filename: string;
    style?: string | null;
    artwork?: string | null;
    submittedById?: string | null;
    titleMasked?: boolean;
    blacklisted?: boolean;
  }> {
    return httpGet(`${BACKEND_URL}/tracks/${trackId}`, {
      headers: await authHeaders(),
      errorMessage: ERROR_MESSAGES.LOADING_FAILED,
      logErrors: true,
    });
  },

  async updateTrack(
    trackId: string,
    patch: {
      title?: string;
      artist?: string;
      style?: string;
      bpm?: number;
      // Paso doble — appels/coups (ADMIN uniquement côté backend, #paso-clashes).
      clashTimecodes?: number[];
    },
  ): Promise<void> {
    await httpPatch(`${BACKEND_URL}/tracks/${trackId}`, patch, {
      headers: await authHeaders(),
      errorMessage: ERROR_MESSAGES.OPERATION_FAILED,
      logErrors: true,
    });
  },

  /** Supprime une piste (ADMIN). */
  async deleteTrack(trackId: string): Promise<void> {
    await httpDelete(`${BACKEND_URL}/tracks/${trackId}`, {
      headers: await authHeaders(),
      errorMessage: ERROR_MESSAGES.OPERATION_FAILED,
      logErrors: true,
      // 409 = propositions de correction en attente : attendu, montré à
      // l'admin, pas une erreur à remonter dans Sentry.
      quietStatuses: [409],
    });
  },
};
