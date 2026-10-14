/**
 * Regression for #584: a stale library (> LIBRARY_MAX_AGE_MS) that the user
 * scrolls must be reloaded exactly once. The focus reload used to depend on
 * `sections.length`, so every loadMore that added a section re-ran the focus
 * effect and fired another full reload (~75 GET /tracks in 5 s → 429).
 *
 * Unlike useLibraryLogic.test.tsx, this suite runs the REAL LibraryProvider so
 * the feedback loop between the focus reload and loadMore can happen.
 */
import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import {
  LIBRARY_MAX_AGE_MS,
  useLibrarySyncStore,
} from "../../../../stores/librarySync.store";
import { createMockNavigation } from "../../../../utils/testUtils";
import { LibraryProvider } from "../../context/LibraryContext";
import { TrackProvider } from "../../context/TrackContext";
import { TrackRepository } from "../../services/TrackRepository";
import { useLibraryLogic } from "../useLibraryLogic";

jest.mock("@sentry/react-native", () => ({
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

jest.mock("../../../auth/context/AuthContext", () => ({
  useAuthRepository: () => ({
    getAuthConfig: jest.fn().mockResolvedValue({}),
  }),
}));

jest.mock("../../context/PlayerContext", () => ({
  usePlayer: () => ({
    playTrack: jest.fn(),
    playNext: jest.fn(),
    addToQueue: jest.fn(),
    currentTrack: null,
    isPlaying: false,
    isLiked: () => false,
  }),
}));

// Mirrors React Navigation on a focused screen: the effect re-runs whenever
// the callback identity changes. `mockRefocus` replays the latest callback of
// every focus effect (keyed by call order), as navigating back to the tab would.
const mockFocusCallbacks: (() => void)[] = [];
let mockFocusIndex = 0;
const mockRefocus = () => mockFocusCallbacks.forEach((cb) => cb());
jest.mock("@react-navigation/native", () => ({
  useFocusEffect: (cb: () => void) => {
    // useLibraryLogic calls useFocusEffect twice per render (library load,
    // default filter): keep the latest callback of each slot.
    mockFocusCallbacks[mockFocusIndex % 2] = cb;
    mockFocusIndex += 1;
    const { useEffect } = require("react") as typeof React;
    useEffect(() => cb(), [cb]);
  },
}));

const TOTAL = 500;
const PAGE = 30;
// One style per 30-track page: every loadMore adds a section in "style" view,
// which is what changed `sections.length` and re-fired the focus effect.
const makeTracks = (count: number, from: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: String(from + i + 1),
    title: `Track ${from + i + 1}`,
    artist: "Artist",
    filename: `t${from + i + 1}.mp3`,
    bpm: 100,
    style: `Style${Math.floor((from + i) / PAGE)}`,
  }));
const servePage = (skip: number, take: number) =>
  Promise.resolve({
    tracks: makeTracks(Math.max(0, Math.min(take, TOTAL - skip)), skip),
    hasMore: skip + take < TOTAL,
    total: TOTAL,
  });

const mockRepo: TrackRepository = {
  getAllTracks: jest.fn().mockResolvedValue([]),
  getTracksPage: jest.fn(servePage),
  getTrackUrl: jest.fn((filename: string) => `file:///${filename}`),
  getArtworkUrl: jest.fn(() => undefined),
  addTrack: jest.fn(),
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <TrackProvider implementation={mockRepo}>
    <LibraryProvider>{children}</LibraryProvider>
  </TrackProvider>
);

/** A reload always starts at offset 0; loadMore never does once loaded. */
const reloadCalls = () =>
  (mockRepo.getTracksPage as jest.Mock).mock.calls.filter(
    ([skip]: [number]) => skip === 0,
  ).length;

describe("useLibraryLogic — stale library + scrolling (#584)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockRepo.getTracksPage as jest.Mock).mockImplementation(servePage);
    useLibrarySyncStore.setState({ version: 0, loadedVersion: 0, loadedAt: 0 });
  });

  it("reloads a stale library exactly once while the user keeps scrolling", async () => {
    const navigation = createMockNavigation();
    const { result } = await renderHook(() => useLibraryLogic({ navigation }), {
      wrapper,
    });
    // First focus: the library is empty → initial load.
    await waitFor(() =>
      expect(result.current.state.allTracks).toHaveLength(30),
    );
    await act(() => {
      result.current.actions.setActiveTab("style");
    });
    await waitFor(() => expect(result.current.state.sections).toHaveLength(1));

    // Ten minutes later the user comes back to the tab: the library is stale.
    useLibrarySyncStore.setState({
      loadedAt: Date.now() - LIBRARY_MAX_AGE_MS - 1,
    });
    // Reloads hang (slow backend) while pages keep coming: the window in
    // which the loop used to happen.
    const pendingReloads: (() => void)[] = [];
    (mockRepo.getTracksPage as jest.Mock).mockClear();
    (mockRepo.getTracksPage as jest.Mock).mockImplementation(
      (skip: number, take: number) =>
        skip === 0
          ? new Promise((resolve) => {
              pendingReloads.push(() => {
                resolve(servePage(skip, take));
              });
            })
          : servePage(skip, take),
    );

    await act(() => {
      mockRefocus();
    });
    expect(reloadCalls()).toBe(1);

    // The user scrolls: each page adds a dance section.
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await result.current.actions.loadMore();
      });
    }
    // Pages that land while the reload is in flight are dropped by the
    // generation guard, so the screen may stay at 30 tracks here; what
    // matters is that no new reload was fired.
    expect(reloadCalls()).toBe(1);

    // The reload lands: the library is fresh again, scrolling stays quiet.
    await act(async () => {
      pendingReloads.forEach((release) => release());
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(useLibrarySyncStore.getState().loadedAt).toBeGreaterThan(
        Date.now() - 1000,
      ),
    );
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await result.current.actions.loadMore();
      });
    }
    expect(reloadCalls()).toBe(1);
  });
});
