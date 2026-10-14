import {
  tracksControllerFindAmbiance,
  tracksControllerUpdate,
} from "../../../api/generated";
import { httpDelete } from "../../../utils/httpInterceptor";
import { TrackApi } from "../track-api";

jest.mock("../../../api/generated", () => ({
  tracksControllerFindAmbiance: jest.fn(),
  tracksControllerUpdate: jest.fn(),
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

describe("TrackApi.blacklistTrack (#561)", () => {
  it("sends only the blacklist flag through the generated client", async () => {
    (tracksControllerUpdate as jest.Mock).mockResolvedValueOnce({
      data: { id: "t1" },
      error: undefined,
      response: { status: 200 },
    });

    await expect(TrackApi.blacklistTrack("t1")).resolves.toBeUndefined();
    expect(tracksControllerUpdate).toHaveBeenCalledWith({
      path: { id: "t1" },
      body: { blacklisted: true },
    });
  });

  it.each([
    [403, "Seul un administrateur peut blacklister un titre."],
    [404, "Ce titre n'existe plus."],
    [500, "L'opération a échoué"],
  ])("maps a %i to a French message", async (status, message) => {
    (tracksControllerUpdate as jest.Mock).mockResolvedValueOnce({
      data: undefined,
      error: { statusCode: status },
      response: { status },
    });

    await expect(TrackApi.blacklistTrack("t1")).rejects.toThrow(message);
  });
});
