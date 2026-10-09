import { act, renderHook } from "@testing-library/react-native";
import {
  LIBRARY_MAX_AGE_MS,
  useLibrarySyncStore,
} from "../../../../stores/librarySync.store";
import { createMockNavigation } from "../../../../utils/testUtils";
import { useLibraryLogic } from "../useLibraryLogic";

const mockPlayTrack = jest.fn().mockResolvedValue(undefined);
const mockPlayNext = jest.fn().mockResolvedValue("queued");
const mockAddToQueue = jest.fn().mockResolvedValue("queued");
const mockSetGroupBy = jest.fn();
const mockSetSearchQuery = jest.fn();
const mockGetAuthConfig = jest.fn();
const mockReloadLibrary = jest.fn().mockResolvedValue(undefined);

jest.mock("../../../auth/context/AuthContext", () => ({
  useAuthRepository: () => ({
    getAuthConfig: mockGetAuthConfig,
  }),
}));

jest.mock("../../context/LibraryContext", () => ({
  useLibrary: () => ({
    sections: [
      {
        title: "Latin",
        data: [
          {
            id: "1",
            title: "Latin Track",
            url: "http://foo",
            artist: "Artist",
            baseBpm: 120,
          },
        ],
      },
      {
        title: "Standard",
        data: [
          {
            id: "2",
            title: "Standard Track",
            url: "http://bar",
            artist: "Artist 2",
            baseBpm: 60,
          },
        ],
      },
    ],
    // allTracks contient un titre de plus que `sections` : simule un morceau
    // filtré par la recherche. displayData doit suivre `sections` (filtré), pas
    // allTracks — sinon la recherche ne filtre pas la vue liste (régression).
    allTracks: [
      {
        id: "1",
        title: "Latin Track",
        url: "http://foo",
        artist: "Artist",
        baseBpm: 120,
      },
      {
        id: "2",
        title: "Standard Track",
        url: "http://bar",
        artist: "Artist 2",
        baseBpm: 60,
      },
      {
        id: "3",
        title: "Filtered Out Track",
        url: "http://baz",
        artist: "Artist 3",
        baseBpm: 90,
      },
    ],
    setGroupBy: mockSetGroupBy,
    searchQuery: "",
    setSearchQuery: mockSetSearchQuery,
    reloadLibrary: mockReloadLibrary,
  }),
}));

jest.mock("../../context/PlayerContext", () => ({
  usePlayer: () => ({
    playTrack: mockPlayTrack,
    playNext: mockPlayNext,
    addToQueue: mockAddToQueue,
    currentTrack: null,
    isPlaying: false,
    isLiked: jest.fn((id: string) => id === "1"),
  }),
}));

jest.mock("@react-navigation/native", () => ({
  useFocusEffect: (cb: () => void) => cb(),
}));

jest.mock("../../../../utils/logger", () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    add: jest.fn(), // Keep add if needed for legacy compatibility during migration? No, better to stick to new interface
    debug: jest.fn(),
  }),
}));

const mockNavigation = createMockNavigation();

describe("useLibraryLogic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthConfig.mockResolvedValue({});
    useLibrarySyncStore.setState({ version: 0, loadedVersion: 0, loadedAt: 0 });
  });

  it("returns initial state with default tab", async () => {
    const { result } = await renderHook(() =>
      useLibraryLogic({ navigation: mockNavigation }),
    );

    expect(result.current.state.activeTab).toBe("default");
    expect(result.current.state.selectedSection).toBeNull();
    expect(result.current.state.displayData).toHaveLength(2);
  });

  it("getDisplayData returns the filtered sections (not raw allTracks) on default tab", async () => {
    const { result } = await renderHook(() =>
      useLibraryLogic({ navigation: mockNavigation }),
    );

    // 3 tracks in allTracks, but only 2 in sections → search filtering wins.
    expect(result.current.state.displayData).toEqual([
      {
        id: "1",
        title: "Latin Track",
        url: "http://foo",
        artist: "Artist",
        baseBpm: 120,
      },
      {
        id: "2",
        title: "Standard Track",
        url: "http://bar",
        artist: "Artist 2",
        baseBpm: 60,
      },
    ]);
    expect(
      result.current.state.displayData.find((t) => t.id === "3"),
    ).toBeUndefined();
  });

  it("calls setGroupBy when activeTab changes to style", async () => {
    const { result } = await renderHook(() =>
      useLibraryLogic({ navigation: mockNavigation }),
    );

    await act(async () => {
      result.current.actions.setActiveTab("style");
    });

    expect(mockSetGroupBy).toHaveBeenCalledWith("style");
  });

  it("calls setGroupBy with default when activeTab is default", async () => {
    const { result } = await renderHook(() =>
      useLibraryLogic({ navigation: mockNavigation }),
    );

    await act(async () => {
      result.current.actions.setActiveTab("default");
    });

    expect(mockSetGroupBy).toHaveBeenCalledWith("default");
  });

  it("handleTrackPress calls playTrack and navigates to AudioPlayer", async () => {
    const { result } = await renderHook(() =>
      useLibraryLogic({ navigation: mockNavigation }),
    );

    const track = {
      id: "1",
      title: "Latin Track",
      url: "http://foo",
      artist: "Artist",
      baseBpm: 120,
    };

    await act(async () => {
      result.current.actions.handleTrackPress(track);
    });

    expect(mockPlayTrack).toHaveBeenCalled();
    expect(mockNavigation.navigate).toHaveBeenCalledWith("AudioPlayer");
  });

  it("handlePlayNext / handleAddToQueue queue the track with the view's playlist label", async () => {
    const { result } = await renderHook(() =>
      useLibraryLogic({ navigation: mockNavigation }),
    );
    const track = {
      id: "9",
      title: "Samba",
      url: "http://foo",
      artist: "Artist",
      baseBpm: 100,
    };

    let next: string | undefined;
    let end: string | undefined;
    await act(async () => {
      next = await result.current.actions.handlePlayNext(track);
      end = await result.current.actions.handleAddToQueue({
        ...track,
        playlist: "Favoris",
      });
    });

    expect(next).toBe("queued");
    expect(end).toBe("queued");
    expect(mockPlayNext).toHaveBeenCalledWith(
      expect.objectContaining({ id: "9", playlist: "Tout" }),
    );
    // An existing label is kept.
    expect(mockAddToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ id: "9", playlist: "Favoris" }),
    );
    // Queueing never opens the player screen.
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });

  it("handleSectionPress sets selectedSection", async () => {
    const { result } = await renderHook(() =>
      useLibraryLogic({ navigation: mockNavigation }),
    );

    const section = {
      title: "Latin",
      data: [
        {
          id: "1",
          title: "Latin Track",
          url: "http://foo",
          artist: "Artist",
          baseBpm: 120,
        },
      ],
    };

    await act(async () => {
      result.current.actions.handleSectionPress(section);
    });

    expect(result.current.state.selectedSection).toEqual(section);
  });

  it("handleBackPress clears selectedSection when section is selected", async () => {
    const { result } = await renderHook(() =>
      useLibraryLogic({ navigation: mockNavigation }),
    );

    const section = {
      title: "Latin",
      data: [
        {
          id: "1",
          title: "Latin Track",
          url: "http://foo",
          artist: "Artist",
          baseBpm: 120,
        },
      ],
    };

    await act(async () => {
      result.current.actions.handleSectionPress(section);
    });
    expect(result.current.state.selectedSection).toEqual(section);

    await act(async () => {
      result.current.actions.handleBackPress();
    });
    expect(result.current.state.selectedSection).toBeNull();
  });

  it("displayData filters by liked tracks when activeTab is likes", async () => {
    const { result } = await renderHook(() =>
      useLibraryLogic({ navigation: mockNavigation }),
    );

    await act(async () => {
      result.current.actions.setActiveTab("likes");
    });

    expect(result.current.state.displayData).toHaveLength(1);
    expect(result.current.state.displayData[0].id).toBe("1");
  });

  it("loads default filter preference from auth config on mount", async () => {
    mockGetAuthConfig.mockResolvedValue({ defaultLibraryFilter: "style" });

    const { result } = await renderHook(() =>
      useLibraryLogic({ navigation: mockNavigation }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.state.activeTab).toBe("style");
  });

  it("currentTrack is exposed in state from player context", async () => {
    const { result } = await renderHook(() =>
      useLibraryLogic({ navigation: mockNavigation }),
    );

    // usePlayer mock returns currentTrack: null
    expect(result.current.state.currentTrack).toBeNull();
  });

  it("setSearchQuery action is wired to library context setSearchQuery", async () => {
    const { result } = await renderHook(() =>
      useLibraryLogic({ navigation: mockNavigation }),
    );

    await act(() => {
      result.current.actions.setSearchQuery("salsa");
    });

    expect(mockSetSearchQuery).toHaveBeenCalledWith("salsa");
  });

  it("sections from library context are exposed in state", async () => {
    const { result } = await renderHook(() =>
      useLibraryLogic({ navigation: mockNavigation }),
    );

    expect(result.current.state.sections).toHaveLength(2);
    expect(result.current.state.sections[0].title).toBe("Latin");
    expect(result.current.state.sections[1].title).toBe("Standard");
  });

  describe("fraîcheur de la bibliothèque au retour sur l'onglet", () => {
    it("ne recharge pas une bibliothèque fraîche déjà affichée", async () => {
      useLibrarySyncStore.setState({
        version: 1,
        loadedVersion: 1,
        loadedAt: Date.now(),
      });
      await renderHook(() => useLibraryLogic({ navigation: mockNavigation }));
      expect(mockReloadLibrary).not.toHaveBeenCalled();
    });

    it("recharge quand une piste a été corrigée depuis le chargement", async () => {
      useLibrarySyncStore.setState({
        version: 2,
        loadedVersion: 1,
        loadedAt: Date.now(),
      });
      await renderHook(() => useLibraryLogic({ navigation: mockNavigation }));
      expect(mockReloadLibrary).toHaveBeenCalled();
    });

    it("recharge une bibliothèque trop ancienne", async () => {
      useLibrarySyncStore.setState({
        version: 1,
        loadedVersion: 1,
        loadedAt: Date.now() - LIBRARY_MAX_AGE_MS - 1,
      });
      await renderHook(() => useLibraryLogic({ navigation: mockNavigation }));
      expect(mockReloadLibrary).toHaveBeenCalled();
    });
  });
});
