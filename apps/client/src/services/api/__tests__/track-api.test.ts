import { tracksControllerFindAmbiance } from "../../../api/generated";
import { httpDelete } from "../../../utils/httpInterceptor";
import { TrackApi } from "../track-api";

jest.mock("../../../api/generated", () => ({
  tracksControllerFindAmbiance: jest.fn(),
}));
jest.mock("../../../utils/httpInterceptor", () => ({
  httpGet: jest.fn(),
  httpPost: jest.fn(),
  httpPatch: jest.fn(),
  httpDelete: jest.fn(),
}));
jest.mock("../../../api/tokenStore", () => ({
  getAccessToken: jest.fn(() => Promise.resolve("tok")),
}));
jest.mock("../../../config", () => ({ BACKEND_URL: "http://api/v1" }));

const dto = {
  id: "a1",
  title: "Lounge",
  artist: "Ambiance",
  filename: "a1.mp3",
  artwork: null,
  style: "Ambiance",
  bpm: 0,
  rawBpm: 0,
  titleMasked: false,
  blacklisted: false,
  clashTimecodes: [],
  createdAt: "2026-10-06T00:00:00Z",
};

describe("TrackApi.getAmbianceTracks", () => {
  it("maps GET /tracks/ambiance items to library tracks", async () => {
    (tracksControllerFindAmbiance as jest.Mock).mockResolvedValueOnce({
      data: [dto],
    });
    await expect(TrackApi.getAmbianceTracks()).resolves.toEqual([
      {
        id: "a1",
        title: "Lounge",
        artist: "Ambiance",
        filename: "a1.mp3",
        bpm: 0,
        style: "Ambiance",
        artwork: undefined,
        titleMasked: false,
        clashTimecodes: [],
      },
    ]);
  });

  it("throws on API error", async () => {
    (tracksControllerFindAmbiance as jest.Mock).mockResolvedValueOnce({
      error: { status: 500 },
    });
    await expect(TrackApi.getAmbianceTracks()).rejects.toThrow();
  });
});

describe("TrackApi.deleteTrack", () => {
  it("does not log the expected 409 (pending proposals) and still throws it", async () => {
    const conflict = Object.assign(new Error("Propositions en attente"), {
      statusCode: 409,
    });
    (httpDelete as jest.Mock).mockRejectedValueOnce(conflict);

    await expect(TrackApi.deleteTrack("t1")).rejects.toBe(conflict);
    expect(httpDelete).toHaveBeenCalledWith(
      "http://api/v1/tracks/t1",
      expect.objectContaining({ logErrors: true, quietStatuses: [409] }),
    );
  });
});
