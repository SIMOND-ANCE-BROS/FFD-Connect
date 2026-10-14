/**
 * UI hooks of the expo-audio wrapper stay quiet in the background (#539).
 *
 * A tester's iPhone killed the app 30-40 s after locking it during playback:
 * "cpu usage — 48 s CPU over 51 s, exceeding limit of 80 % cpu over 60
 * seconds", app not frontmost. Status ticks must keep reaching Event listeners
 * (queue advance, competition mode) but must not re-render the UI there.
 */
import { act, renderHook } from "@testing-library/react-native";
import { createAudioPlayer } from "expo-audio";
import { AppState, type AppStateStatus } from "react-native";
import TrackPlayer, { Event, State, useProgress } from "../TrackPlayerWrapper";

jest.mock("../../../modules/lockscreen-transport", () => ({
  __esModule: true,
  default: null,
}));

type Status = Record<string, unknown>;

let current: AppStateStatus = "active";
let emitAppState: (status: AppStateStatus) => void = () => {};
let emitStatus: (status: Status) => void = () => {};

const tick = (currentTime: number): Status => ({
  isLoaded: true,
  playing: true,
  isBuffering: false,
  currentTime,
  duration: 120,
  didJustFinish: false,
});

describe("TrackPlayerWrapper — background (#539)", () => {
  beforeAll(async () => {
    Object.defineProperty(AppState, "currentState", {
      configurable: true,
      get: () => current,
    });
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_event, handler) => {
        emitAppState = handler;
        return { remove: jest.fn() };
      });

    await TrackPlayer.setupPlayer();
    const player = (createAudioPlayer as jest.Mock).mock.results.at(-1)
      ?.value as { addListener: jest.Mock };
    const call = player.addListener.mock.calls.find(
      ([name]: [string]) => name === "playbackStatusUpdate",
    );
    emitStatus = call?.[1] as (status: Status) => void;
  });

  beforeEach(() => {
    current = "active";
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it("updates the progress hook in the foreground only", async () => {
    let renders = 0;
    const { result } = await renderHook(() => {
      renders += 1;
      return useProgress();
    });

    await act(() => emitStatus(tick(1)));
    expect(result.current.position).toBe(1);
    const foregroundRenders = renders;

    current = "background";
    await act(() => {
      for (let t = 2; t <= 40; t += 1) emitStatus(tick(t));
    });
    expect(renders).toBe(foregroundRenders);
    expect(result.current.position).toBe(1);

    // Back in front: the UI catches up at once.
    current = "active";
    await act(() => emitAppState("active"));
    expect(result.current.position).toBe(40);
  });

  it("keeps feeding Event listeners in the background", () => {
    const listener = jest.fn();
    TrackPlayer.addEventListener(Event.PlaybackState, listener);

    current = "background";
    emitStatus(tick(3));

    expect(listener).toHaveBeenCalledWith({ state: State.Playing });
  });
});
