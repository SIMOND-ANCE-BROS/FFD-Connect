import { TrackApi } from "../../../../services/api/track-api";
import type { Track } from "../../../player/services/TrackRepository";
import { loadCompetitionLibrary } from "../competitionLibrary";

jest.mock("../../../../services/api/track-api", () => ({
  TrackApi: { getAmbianceTracks: jest.fn() },
}));
jest.mock("../../../../utils/logger", () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
}));

const raw = (id: string, style: string): Track => ({
  id,
  title: `${style} ${id}`,
  artist: "A",
  filename: `${id}.mp3`,
  bpm: 30,
  style,
});

const repo = {
  getTracksPage: jest.fn(),
  getTrackUrl: (f?: string | null) => `https://static/uploads/${f ?? ""}`,
  getArtworkUrl: () => undefined,
};

describe("loadCompetitionLibrary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (TrackApi.getAmbianceTracks as jest.Mock).mockResolvedValue([
      raw("a1", "Ambiance"),
    ]);
  });

  it("pages through the whole catalogue and maps ambiance like library tracks", async () => {
    repo.getTracksPage
      .mockResolvedValueOnce({
        tracks: [raw("1", "Samba")],
        hasMore: true,
        total: 2,
      })
      .mockResolvedValueOnce({
        tracks: [raw("2", "Tango")],
        hasMore: false,
        total: 2,
      });

    const lib = await loadCompetitionLibrary(repo, []);

    expect(repo.getTracksPage).toHaveBeenNthCalledWith(1, 0, 100);
    expect(repo.getTracksPage).toHaveBeenNthCalledWith(2, 100, 100);
    expect(lib.tracks.map((t) => t.id)).toEqual(["1", "2"]);
    expect(lib.ambiance).toEqual([
      expect.objectContaining({
        id: "a1",
        url: "https://static/uploads/a1.mp3",
        style: "Ambiance",
        playlist: "Tout",
      }),
    ]);
  });

  it("keeps already-loaded tracks first (offline copies) and dedups", async () => {
    repo.getTracksPage.mockResolvedValueOnce({
      tracks: [raw("1", "Samba")],
      hasMore: false,
      total: 1,
    });
    const known = {
      id: "1",
      title: "Samba 1",
      artist: "A",
      url: "file:///doc/1.mp3",
      baseBpm: 30,
      style: "Samba",
    };
    const lib = await loadCompetitionLibrary(repo, [known]);
    expect(lib.tracks).toEqual([known]);
  });

  it("falls back to loaded tracks and silent breaks on network errors", async () => {
    repo.getTracksPage.mockRejectedValueOnce(new Error("offline"));
    (TrackApi.getAmbianceTracks as jest.Mock).mockRejectedValueOnce(
      new Error("404"),
    );
    const known = {
      id: "9",
      title: "Jive",
      artist: "A",
      url: "https://x/9.mp3",
      baseBpm: 40,
      style: "Jive",
    };
    const lib = await loadCompetitionLibrary(repo, [known]);
    expect(lib.tracks).toEqual([known]);
    expect(lib.ambiance).toEqual([]);
  });

  it("separates legacy ambiance tracks found in the library", async () => {
    repo.getTracksPage.mockResolvedValueOnce({
      tracks: [raw("1", "Samba"), raw("x", "ambiance")],
      hasMore: false,
      total: 2,
    });
    (TrackApi.getAmbianceTracks as jest.Mock).mockResolvedValueOnce([]);
    const lib = await loadCompetitionLibrary(repo, []);
    expect(lib.tracks.map((t) => t.id)).toEqual(["1"]);
    expect(lib.ambiance.map((t) => t.id)).toEqual(["x"]);
  });
});
