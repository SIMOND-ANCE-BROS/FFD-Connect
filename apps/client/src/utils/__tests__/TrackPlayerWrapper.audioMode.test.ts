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

  it("is not reported as set up while the audio mode failed", async () => {
    setAudioModeAsync.mockRejectedValueOnce(new Error("session busy"));

    await expect(TrackPlayer.setupPlayer()).rejects.toThrow("session busy");

    // The player exists, but the next readiness check must fail so that
    // TrackPlayerService runs setupPlayer (and the audio mode) again.
    await expect(TrackPlayer.getCurrentTrack()).rejects.toThrow(
      "Player not set up",
    );

    await TrackPlayer.setupPlayer();
    await expect(TrackPlayer.getCurrentTrack()).resolves.toBeNull();
    expect(setAudioModeAsync).toHaveBeenCalledTimes(2);
  });

  it("re-applies a failed audio mode before starting playback", async () => {
    setAudioModeAsync.mockRejectedValueOnce(new Error("session busy"));
    await TrackPlayer.setupPlayer().catch(() => {});

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
