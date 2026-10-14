/**
 * Background audio mode for the expo-audio wrapper (#539).
 *
 * expo-audio pauses every player when the app is backgrounded (phone locked)
 * unless setAudioModeAsync({ shouldPlayInBackground: true }) succeeded. A
 * rejected first attempt used to leave the player "set up" without that mode,
 * forever: getCurrentTrack() resolved as soon as the player existed, so
 * TrackPlayerService never retried.
 */
jest.mock("../../../modules/lockscreen-transport", () => ({
  __esModule: true,
  default: null,
}));

// logger.error is what reaches Sentry; expose its spy (fresh per registry).
jest.mock("../logger", () => {
  const error = jest.fn();
  return {
    __esModule: true,
    __loggerError: error,
    createLogger: () => ({
      error,
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    }),
  };
});

describe("TrackPlayerWrapper — background audio mode (#539)", () => {
  let TrackPlayer: typeof import("../TrackPlayerWrapper").default;
  let setAudioModeAsync: jest.Mock;
  let createAudioPlayer: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    const expoAudio = require("expo-audio") as {
      setAudioModeAsync: jest.Mock;
      createAudioPlayer: jest.Mock;
    };
    setAudioModeAsync = expoAudio.setAudioModeAsync;
    createAudioPlayer = expoAudio.createAudioPlayer;
    setAudioModeAsync.mockReset();
    setAudioModeAsync.mockResolvedValue(undefined);
    TrackPlayer = require("../TrackPlayerWrapper").default;
  });

  it("asks for background playback in doNotMix mode", async () => {
    await TrackPlayer.setupPlayer();

    expect(setAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: "doNotMix",
      }),
    );
    await expect(TrackPlayer.getCurrentTrack()).resolves.toBeNull();
  });

  it("never blocks setup on a failing audio mode", async () => {
    setAudioModeAsync.mockRejectedValue(new Error("session busy"));

    await expect(TrackPlayer.setupPlayer()).resolves.toBeUndefined();
    // Ready for playback: foreground playback works without the mode.
    await expect(TrackPlayer.getCurrentTrack()).resolves.toBeNull();
  });

  it("reports a failure to Sentry once per distinct error", async () => {
    const logError = (require("../logger") as { __loggerError: jest.Mock })
      .__loggerError;
    setAudioModeAsync.mockRejectedValue(new Error("session busy"));

    await TrackPlayer.setupPlayer();
    await TrackPlayer.play();
    await TrackPlayer.play();
    expect(logError).toHaveBeenCalledTimes(1);

    setAudioModeAsync.mockRejectedValue(new Error("media services reset"));
    await TrackPlayer.play();
    expect(logError).toHaveBeenCalledTimes(2);
  });

  it("re-applies a failed audio mode before starting playback", async () => {
    setAudioModeAsync.mockRejectedValueOnce(new Error("session busy"));
    await TrackPlayer.setupPlayer();

    await TrackPlayer.play();

    expect(setAudioModeAsync).toHaveBeenCalledTimes(2);
    const player = createAudioPlayer.mock.results[0].value as {
      play: jest.Mock;
    };
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it("still plays when the audio mode keeps failing", async () => {
    setAudioModeAsync.mockRejectedValue(new Error("session busy"));

    await TrackPlayer.play();

    const player = createAudioPlayer.mock.results[0].value as {
      play: jest.Mock;
    };
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it("does not reconfigure the session on every play once applied", async () => {
    await TrackPlayer.setupPlayer();
    await TrackPlayer.play();
    await TrackPlayer.play();

    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
  });
});
