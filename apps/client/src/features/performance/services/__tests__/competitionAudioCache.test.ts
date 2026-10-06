import {
  deleteAsync,
  downloadAsync,
  getInfoAsync,
  moveAsync,
} from "expo-file-system/legacy";
import type { TrackData } from "../../../player/context/PlayerContext";
import {
  cacheTrack,
  runWithProgress,
  trackCacheUri,
  TrackDownloadError,
} from "../competitionAudioCache";

jest.mock("../../../../utils/logger", () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
}));

const track: TrackData = {
  id: "42",
  title: "Samba de Janeiro",
  artist: "X",
  url: "https://static/uploads/samba%20one.m4a?sig=1",
  baseBpm: 50,
  style: "Samba",
};

describe("trackCacheUri", () => {
  it("is deterministic, keyed by id + url, keeps the extension", () => {
    const uri = trackCacheUri({ id: "42", url: track.url as string });
    expect(uri).toBe(trackCacheUri({ id: "42", url: track.url as string }));
    expect(uri).toMatch(/perf_v1_42_[0-9a-f]{8}_[0-9a-z]+\.m4a$/);
    expect(uri).not.toBe(
      trackCacheUri({ id: "42", url: "https://static/uploads/other.m4a" }),
    );
  });
});

describe("cacheTrack", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });
  });

  it("skips the download when the file is already cached", async () => {
    (getInfoAsync as jest.Mock).mockResolvedValueOnce({
      exists: true,
      size: 1000,
    });
    const uri = await cacheTrack(track);
    expect(uri).toContain("perf_v1_42_");
    expect(downloadAsync).not.toHaveBeenCalled();
  });

  it("reuses an existing local copy (offline favourite)", async () => {
    (getInfoAsync as jest.Mock).mockResolvedValueOnce({
      exists: true,
      size: 1000,
    });
    const local = { ...track, url: "file:///doc/samba.mp3" };
    await expect(cacheTrack(local)).resolves.toBe("file:///doc/samba.mp3");
    expect(downloadAsync).not.toHaveBeenCalled();
  });

  it("downloads to the cache and returns the local uri", async () => {
    (downloadAsync as jest.Mock).mockResolvedValueOnce({ status: 200 });
    const uri = await cacheTrack(track);
    const partUri = (downloadAsync as jest.Mock).mock.calls[0][1] as string;
    // Written to a unique .part, moved to the cache path once complete.
    expect(partUri.startsWith(`${uri}.`)).toBe(true);
    expect(partUri.endsWith(".part")).toBe(true);
    expect(moveAsync).toHaveBeenCalledWith({ from: partUri, to: uri });
  });

  it("retries once after a failure, then succeeds", async () => {
    (downloadAsync as jest.Mock)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ status: 200 });
    await expect(cacheTrack(track)).resolves.toContain("perf_v1_42_");
    expect(downloadAsync).toHaveBeenCalledTimes(2);
  });

  it("throws a TrackDownloadError after two failed attempts and purges the error body", async () => {
    (downloadAsync as jest.Mock).mockResolvedValue({ status: 503 });
    await expect(cacheTrack(track)).rejects.toBeInstanceOf(TrackDownloadError);
    expect(downloadAsync).toHaveBeenCalledTimes(2);
    // Only the .part files are purged; nothing partial reaches the cache path.
    const parts = (downloadAsync as jest.Mock).mock.calls.map((c) => c[1]);
    parts.forEach((p) =>
      expect(deleteAsync).toHaveBeenCalledWith(p, { idempotent: true }),
    );
    expect(moveAsync).not.toHaveBeenCalled();
  });

  it("rejects a track without url", async () => {
    await expect(cacheTrack({ ...track, url: "" })).rejects.toBeInstanceOf(
      TrackDownloadError,
    );
  });
});

describe("runWithProgress", () => {
  it("stops starting tasks once cancelled", async () => {
    let alive = true;
    const second = jest.fn(() => Promise.resolve(2));
    await runWithProgress(
      [
        () => {
          alive = false;
          return Promise.resolve(1);
        },
        second,
      ],
      () => {},
      1,
      () => alive,
    );
    expect(second).not.toHaveBeenCalled();
  });

  it("runs every task and reports progress up to total", async () => {
    const progress: string[] = [];
    const results = await runWithProgress(
      [1, 2, 3, 4].map((n) => () => Promise.resolve(n * 10)),
      (done, total) => progress.push(`${done}/${total}`),
      2,
    );
    expect(results).toEqual([10, 20, 30, 40]);
    expect(progress[0]).toBe("0/4");
    expect(progress[progress.length - 1]).toBe("4/4");
  });

  it("rejects on the first failure and stops starting new tasks", async () => {
    const late = jest.fn(() => Promise.resolve(3));
    await expect(
      runWithProgress(
        [() => Promise.reject(new Error("boom")), late],
        () => {},
        1,
      ),
    ).rejects.toThrow("boom");
    expect(late).not.toHaveBeenCalled();
  });
});
