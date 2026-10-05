import TrackPlayer from "../../../../utils/TrackPlayerWrapper";
import { setupPlayer, setupService } from "../TrackPlayerService";

jest.mock("../../../../utils/TrackPlayerWrapper", () => {
  const TrackPlayerMock = {
    getCurrentTrack: jest.fn(),
    setupPlayer: jest.fn().mockResolvedValue(undefined),
    updateOptions: jest.fn().mockResolvedValue(undefined),
    addEventListener: jest.fn(),
    play: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
    skipToNext: jest.fn().mockResolvedValue(undefined),
    skipToPrevious: jest.fn().mockResolvedValue(undefined),
    seekTo: jest.fn().mockResolvedValue(undefined),
    registerPlaybackService: jest.fn(),
  };

  return {
    __esModule: true,
    default: TrackPlayerMock,
    Event: {
      RemotePlay: "remote-play",
      RemotePause: "remote-pause",
      RemoteStop: "remote-stop",
      RemoteNext: "remote-next",
      RemotePrevious: "remote-previous",
      RemoteSeek: "remote-seek",
    },
    Capability: {
      Play: "CAPABILITY_PLAY",
      Pause: "CAPABILITY_PAUSE",
      Stop: "CAPABILITY_STOP",
      SeekTo: "CAPABILITY_SEEK_TO",
      SkipToNext: "CAPABILITY_SKIP_TO_NEXT",
      SkipToPrevious: "CAPABILITY_SKIP_TO_PREVIOUS",
    },
  };
});

describe("TrackPlayerService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("setupPlayer", () => {
    it("skips setup if player is already initialized", async () => {
      (TrackPlayer.getCurrentTrack as jest.Mock).mockResolvedValue("track-1");

      const result = await setupPlayer();

      expect(result).toBe(true);

      expect(TrackPlayer.setupPlayer).not.toHaveBeenCalled();
    });

    it("sets up player when not initialized (getCurrentTrack throws)", async () => {
      (TrackPlayer.getCurrentTrack as jest.Mock).mockRejectedValue(
        new Error("no track"),
      );

      const result = await setupPlayer();

      expect(result).toBe(true);

      expect(TrackPlayer.setupPlayer).toHaveBeenCalled();

      expect(TrackPlayer.updateOptions).toHaveBeenCalled();
    });
  });

  describe("setupService", () => {
    it("registers all remote event handlers", async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await setupService();

      const events = [
        "remote-play",
        "remote-pause",
        "remote-stop",
        "remote-next",
        "remote-previous",
        "remote-seek",
      ];

      events.forEach((event) => {
        expect(TrackPlayer.addEventListener).toHaveBeenCalledWith(
          event,
          expect.any(Function),
        );
      });
    });

    it("event handlers call corresponding TrackPlayer methods", async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await setupService();

      // Trigger RemotePlay
      const playHandler = (
        TrackPlayer.addEventListener as jest.Mock
      ).mock.calls.find((call) => call[0] === "remote-play")[1];
      playHandler();

      expect(TrackPlayer.play).toHaveBeenCalled();

      // Trigger RemoteSeek
      const seekHandler = (
        TrackPlayer.addEventListener as jest.Mock
      ).mock.calls.find((call) => call[0] === "remote-seek")[1];
      seekHandler({ position: 42 });

      expect(TrackPlayer.seekTo).toHaveBeenCalledWith(42);
    });
  });
});
