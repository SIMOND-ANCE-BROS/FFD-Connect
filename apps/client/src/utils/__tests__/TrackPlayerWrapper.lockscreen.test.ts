/**
 * Lock-screen / Control Center wiring for the expo-audio wrapper.
 *
 * Guards the regression where the RNTP→expo-audio migration dropped the
 * "Now Playing" controls: loading a track must publish its metadata and claim
 * the lock screen, and reset() must release it.
 */
// The expo-audio native module is mocked globally in jest.setup.js with a
// controllable fake player (createAudioPlayer.mock.results holds the instance).
// It is re-required inside beforeEach so it matches the wrapper's copy after
// jest.resetModules().

// The LockscreenTransport local native module is iOS-only (null in jest by
// default via requireOptionalNativeModule) — mock it so the ⏮ ⏭ wiring is
// exercised. The factory re-runs per module registry (jest.resetModules), so
// each test gets fresh spies shared with the wrapper's copy.
jest.mock("../../../modules/lockscreen-transport", () => ({
  __esModule: true,
  default: {
    setEnabled: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

type FakePlayer = {
  setActiveForLockScreen: jest.Mock;
  updateLockScreenMetadata: jest.Mock;
  clearLockScreenControls: jest.Mock;
  replace: jest.Mock;
  play: jest.Mock;
  seekTo: jest.Mock;
  addListener: jest.Mock;
};

type FakeTransport = {
  setEnabled: jest.Mock;
  addListener: jest.Mock;
};

// Find the wrapper's listener for a LockscreenTransport event.
function transportListener(
  transport: FakeTransport,
  event: string,
): () => void {
  const call = transport.addListener.mock.calls.find(
    ([name]: [string]) => name === event,
  );
  if (!call) throw new Error(`no listener registered for ${event}`);
  return call[1] as () => void;
}

const TRACK_A = {
  id: "a",
  url: "file:///a.mp3",
  title: "Cha Cha 32 BPM",
  artist: "FFD",
  artwork: "file:///a.jpg",
};
const TRACK_B = {
  id: "b",
  url: "file:///b.mp3",
  title: "Rumba 26 BPM",
  artist: "FFD",
  artwork: undefined,
};

describe("TrackPlayerWrapper — lock screen", () => {
  let TrackPlayer: typeof import("../TrackPlayerWrapper").default;
  let player: FakePlayer;
  let transport: FakeTransport;

  // Push a fake playbackStatusUpdate through the wrapper's status listener
  // (drives lastStatus, e.g. the current playback position).
  function emitStatus(status: Record<string, unknown>): void {
    const call = player.addListener.mock.calls.find(
      ([name]: [string]) => name === "playbackStatusUpdate",
    );
    if (!call) throw new Error("wrapper did not register a status listener");
    (call[1] as (s: unknown) => void)(status);
  }

  beforeEach(async () => {
    jest.resetModules();
    // Re-require the wrapper so its module-level singleton state is fresh; read
    // createAudioPlayer + the transport mock from the same fresh module graph
    // the wrapper sees.
    const createAudioPlayer = require("expo-audio")
      .createAudioPlayer as jest.Mock;
    transport = require("../../../modules/lockscreen-transport")
      .default as FakeTransport;
    TrackPlayer = require("../TrackPlayerWrapper").default;
    await TrackPlayer.setupPlayer();
    // ensurePlayer runs lazily on the first queue op; add() triggers it.
    await TrackPlayer.add([TRACK_A]);
    player = createAudioPlayer.mock.results[0].value as FakePlayer;
  });

  it("claims the lock screen with metadata on the first loaded track", () => {
    expect(player.setActiveForLockScreen).toHaveBeenCalledTimes(1);
    const [active, metadata] = player.setActiveForLockScreen.mock.calls[0];
    expect(active).toBe(true);
    expect(metadata).toMatchObject({
      title: "Cha Cha 32 BPM",
      artist: "FFD",
      artworkUrl: "file:///a.jpg",
    });
  });

  it("updates (not re-claims) metadata when moving to the next track", async () => {
    player.setActiveForLockScreen.mockClear();
    await TrackPlayer.add([TRACK_B]);
    await TrackPlayer.skip(1);

    expect(player.setActiveForLockScreen).not.toHaveBeenCalled();
    expect(player.updateLockScreenMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Rumba 26 BPM", artworkUrl: undefined }),
    );
  });

  it("releases the lock screen on reset", async () => {
    await TrackPlayer.reset();
    expect(player.clearLockScreenControls).toHaveBeenCalledTimes(1);
  });

  describe("⏮ ⏭ transport (LockscreenTransport module)", () => {
    it("enables the buttons when claiming the lock screen, disables on reset", async () => {
      expect(transport.setEnabled).toHaveBeenCalledWith(true);
      await TrackPlayer.reset();
      expect(transport.setEnabled).toHaveBeenLastCalledWith(false);
    });

    it("remote next advances to the next track", async () => {
      await TrackPlayer.add([TRACK_B]);
      player.replace.mockClear();

      transportListener(transport, "onRemoteNext")();

      expect(player.replace).toHaveBeenCalledWith({ uri: TRACK_B.url });
      expect(player.play).toHaveBeenCalled();
    });

    it("remote previous restarts the track when >3s in", async () => {
      await TrackPlayer.add([TRACK_B]);
      await TrackPlayer.skip(1);
      player.replace.mockClear();
      emitStatus({ isLoaded: true, playing: true, currentTime: 42 });

      transportListener(transport, "onRemotePrevious")();

      expect(player.seekTo).toHaveBeenCalledWith(0);
      expect(player.replace).not.toHaveBeenCalled(); // same track, no reload
    });

    it("remote previous goes to the previous track when <3s in", async () => {
      await TrackPlayer.add([TRACK_B]);
      await TrackPlayer.skip(1);
      player.replace.mockClear();
      emitStatus({ isLoaded: true, playing: true, currentTime: 1 });

      transportListener(transport, "onRemotePrevious")();

      expect(player.replace).toHaveBeenCalledWith({ uri: TRACK_A.url });
      expect(player.play).toHaveBeenCalled();
    });
  });
});
