import { renderHook } from "@testing-library/react-native";
import React from "react";
import { TrackRepository } from "../../services/TrackRepository";
import { TrackProvider, useTrackRepository } from "../TrackContext";

const mockRepo: TrackRepository = {
  getAllTracks: jest.fn().mockResolvedValue([]),
  getTracksPage: jest.fn().mockResolvedValue({
    tracks: [],
    hasMore: false,
    total: 0,
  }),
  getTrackUrl: jest.fn((filename: string) => `file://tracks/${filename}`),
  getArtworkUrl: jest.fn((artwork?: string | null) =>
    artwork ? `file://artwork/${artwork}` : undefined,
  ),
  addTrack: jest.fn(),
};

describe("TrackContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("useTrackRepository returns implementation when inside provider", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <TrackProvider implementation={mockRepo}>{children}</TrackProvider>
    );
    const { result } = await renderHook(() => useTrackRepository(), {
      wrapper,
    });

    expect(result.current).toBe(mockRepo);
    expect(result.current.getTrackUrl("test.mp3")).toBe(
      "file://tracks/test.mp3",
    );
  });

  it("useTrackRepository throws when outside provider", async () => {
    await expect(renderHook(() => useTrackRepository())).rejects.toThrow(
      "useTrackRepository must be used within TrackProvider",
    );
  });

  it("TrackProvider passes implementation to children", async () => {
    (mockRepo.getAllTracks as jest.Mock).mockResolvedValue([
      {
        id: "1",
        title: "Track 1",
        artist: "Artist",
        filename: "track1.mp3",
        bpm: 120,
      },
    ]);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <TrackProvider implementation={mockRepo}>{children}</TrackProvider>
    );
    const { result } = await renderHook(() => useTrackRepository(), {
      wrapper,
    });

    const tracks = await result.current.getAllTracks();
    expect(tracks).toHaveLength(1);
    expect(tracks[0].title).toBe("Track 1");
  });
});
