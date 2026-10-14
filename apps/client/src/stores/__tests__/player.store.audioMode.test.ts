/**
 * End to end through the real store → TrackPlayerService → TrackPlayerWrapper
 * (only expo-audio is faked, globally in jest.setup.js): a background audio
 * mode that keeps failing must never prevent playback in the foreground
 * (#539 review — the first version of the fix made setup fail, so playTrack
 * returned before play()).
 */
import { Alert } from "react-native";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { usePlayerStore, type TrackData } from "../player.store";

jest.mock("../../../modules/lockscreen-transport", () => ({
  __esModule: true,
  default: null,
}));

const track: TrackData = {
  id: "t1",
  url: "https://cdn/t1.mp3",
  title: "Cha Cha",
  artist: "FFD",
  baseBpm: 120,
};

describe("player.store with a persistently failing audio mode (#539)", () => {
  beforeEach(() => {
    (setAudioModeAsync as jest.Mock).mockReset();
    (setAudioModeAsync as jest.Mock).mockRejectedValue(
      new Error("session busy"),
    );
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("still gets ready and starts the track", async () => {
    await expect(usePlayerStore.getState().ensurePlayerReady()).resolves.toBe(
      true,
    );

    await usePlayerStore.getState().playTrack(track);

    const player = (createAudioPlayer as jest.Mock).mock.results.at(-1)
      ?.value as { play: jest.Mock; replace: jest.Mock };
    expect(player.replace).toHaveBeenCalledWith({ uri: track.url });
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().currentTrack?.id).toBe("t1");
    // No "Lecture audio — diagnostic" alert for the tester on every tap.
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
