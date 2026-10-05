import { STATIC_BASE_URL } from "../../../config";
import api from "../../../services/api";
import { createLogger } from "../../../utils/logger";
import { Track, TrackRepository, TracksPageResponse } from "./TrackRepository";

const logger = createLogger("TrackService");

type TracksApiResponse = {
  data: Track[];
  meta: { total: number; skip: number; take: number; hasMore: boolean };
};

export class TrackService implements TrackRepository {
  async getTracksPage(skip: number, take: number): Promise<TracksPageResponse> {
    try {
      const response = await api.get<TracksApiResponse>("/tracks", {
        params: { skip, take },
      });
      const body = response.data;
      if (!Array.isArray(body.data)) {
        return { tracks: [], hasMore: false, total: 0 };
      }
      const meta = body.meta;
      return {
        tracks: body.data,
        hasMore: meta.hasMore,
        total: meta.total,
      };
    } catch (error) {
      logger.error("Error fetching tracks page:", error);
      throw error;
    }
  }

  async getAllTracks(_filter?: string): Promise<Track[]> {
    try {
      const { tracks } = await this.getTracksPage(0, 100);
      return tracks;
    } catch (error) {
      logger.error("Error fetching tracks:", error);
      throw error;
    }
  }

  getTrackUrl(filename?: string | null): string {
    if (filename == null || filename === "") return "";
    if (!STATIC_BASE_URL) return "";
    try {
      return `${STATIC_BASE_URL}/uploads/${encodeURIComponent(String(filename))}`;
    } catch {
      return "";
    }
  }

  getArtworkUrl(artworkFilename?: string | null): string | undefined {
    if (artworkFilename == null || artworkFilename === "") return undefined;
    const str = String(artworkFilename).trim();
    if (str.startsWith("http://") || str.startsWith("https://")) {
      return str;
    }
    if (!STATIC_BASE_URL) return undefined;
    try {
      return `${STATIC_BASE_URL}/uploads/${encodeURIComponent(str)}`;
    } catch {
      return undefined;
    }
  }

  async addTrack(track: Partial<Track>): Promise<void> {
    try {
      // If track has a URL, use the process endpoint to download and process it
      if (track.filename?.match(/^https?:\/\//i)) {
        const url = track.filename;
        const style = track.style;
        await api.post("/tracks/process", { url, style });
        logger.info("Track processed successfully from URL", { url, style });
        return;
      }

      // Otherwise, create track metadata directly (requires backend endpoint)
      // For now, log a warning as manual track creation without URL processing
      // is not yet implemented in the backend
      logger.warn(
        "Manual track creation without URL processing is not yet supported. Use /tracks/process endpoint with a URL instead.",
        track,
      );
      throw new Error(
        "Track creation requires a URL. Use the process endpoint instead.",
      );
    } catch (error) {
      logger.error("Error adding track:", error);
      throw error;
    }
  }
}
