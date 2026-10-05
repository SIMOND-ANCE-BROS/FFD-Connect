import { STATIC_BASE_URL } from "../../../../config";
import api from "../../../../services/api";
import { TrackService } from "../TrackService";

jest.mock("../../../../services/api", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

jest.mock("../../../../utils/logger", () => ({
  createLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}));

const mockApi = api as jest.Mocked<typeof api>;

describe("TrackService", () => {
  let service: TrackService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TrackService();
  });

  describe("getTracksPage", () => {
    it("fetches a page and returns tracks with hasMore and total", async () => {
      const tracks = [
        { id: "1", title: "Track 1", artist: "A", filename: "f.mp3", bpm: 120 },
      ];
      mockApi.get.mockResolvedValue({
        data: {
          data: tracks,
          meta: { total: 1, skip: 0, take: 30, hasMore: false },
        },
      });

      const result = await service.getTracksPage(0, 30);

      expect(mockApi.get).toHaveBeenCalledWith("/tracks", {
        params: { skip: 0, take: 30 },
      });
      expect(result).toEqual({ tracks, hasMore: false, total: 1 });
    });

    it("returns hasMore true when more pages exist", async () => {
      const tracks = [
        { id: "1", title: "T1", artist: "A", filename: "f.mp3", bpm: 120 },
      ];
      mockApi.get.mockResolvedValue({
        data: {
          data: tracks,
          meta: { total: 50, skip: 0, take: 30, hasMore: true },
        },
      });

      const result = await service.getTracksPage(0, 30);

      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(50);
    });

    it("propagates API errors", async () => {
      mockApi.get.mockRejectedValue(new Error("Network error"));
      await expect(service.getTracksPage(0, 30)).rejects.toThrow(
        "Network error",
      );
    });
  });

  describe("getAllTracks", () => {
    it("returns first 100 tracks via getTracksPage", async () => {
      const tracks = [
        { id: "1", title: "Track 1", artist: "A", filename: "f.mp3", bpm: 120 },
      ];
      mockApi.get.mockResolvedValue({
        data: {
          data: tracks,
          meta: { total: 1, skip: 0, take: 100, hasMore: false },
        },
      });

      const result = await service.getAllTracks();

      expect(mockApi.get).toHaveBeenCalledWith("/tracks", {
        params: { skip: 0, take: 100 },
      });
      expect(result).toEqual(tracks);
    });

    it("propagates API errors", async () => {
      mockApi.get.mockRejectedValue(new Error("Network error"));
      await expect(service.getAllTracks()).rejects.toThrow("Network error");
    });
  });

  describe("URL mapping", () => {
    it("getTrackUrl returns encoded URL", () => {
      const url = service.getTrackUrl("my track.mp3");
      expect(url).toBe(`${STATIC_BASE_URL}/uploads/my%20track.mp3`);
    });

    it("getArtworkUrl returns encoded URL for valid filename", () => {
      const url = service.getArtworkUrl("cover art.jpg");
      expect(url).toBe(`${STATIC_BASE_URL}/uploads/cover%20art.jpg`);
    });

    it("getArtworkUrl returns undefined for null or empty filename", () => {
      expect(service.getArtworkUrl(undefined)).toBeUndefined();
      expect(service.getArtworkUrl(null)).toBeUndefined();
    });
  });

  describe("addTrack", () => {
    it("processes track with URL via /tracks/process", async () => {
      mockApi.post.mockResolvedValue({ data: {} });

      await service.addTrack({
        filename: "https://example.com/audio.mp3",
        style: "valse",
      });

      expect(mockApi.post).toHaveBeenCalledWith("/tracks/process", {
        url: "https://example.com/audio.mp3",
        style: "valse",
      });
    });

    it("throws error when no URL is provided in filename", async () => {
      await expect(service.addTrack({ title: "Local Track" })).rejects.toThrow(
        "Track creation requires a URL",
      );
    });

    it("propagates API errors from post", async () => {
      const apiError = new Error("Process failed");
      mockApi.post.mockRejectedValue(apiError);

      await expect(
        service.addTrack({ filename: "https://youtube.com/watch?v=123" }),
      ).rejects.toThrow("Process failed");
    });
  });
});
