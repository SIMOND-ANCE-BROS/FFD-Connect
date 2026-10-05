import { getAccessToken } from "../../api/tokenStore";
import { BACKEND_URL } from "../../config";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import {
  httpDelete,
  httpGet,
  httpPatch,
  httpPost,
} from "../../utils/httpInterceptor";

/** Motifs de signalement d'un problème sur une piste (miroir du backend). */
export type ReportTrackReason =
  | "TITLE"
  | "ARTIST"
  | "DANCE"
  | "MPM"
  | "PASO_CLASH"
  | "OTHER";

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export const TrackApi = {
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
    });
  },

  /**
   * Signale un problème sur une piste (tout utilisateur authentifié).
   * Le backend notifie chaque administrateur.
   */
  async reportTrack(
    trackId: string,
    reason: ReportTrackReason,
    message?: string,
  ): Promise<void> {
    await httpPost(
      `${BACKEND_URL}/tracks/${trackId}/report`,
      { reason, message },
      {
        headers: await authHeaders(),
        errorMessage: ERROR_MESSAGES.OPERATION_FAILED,
        logErrors: true,
      },
    );
  },
};
