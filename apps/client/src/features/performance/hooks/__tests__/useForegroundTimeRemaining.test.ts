import { act, renderHook } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { usePerformanceStore } from "../../../../stores/performance.store";
import { useForegroundTimeRemaining } from "../useForegroundTimeRemaining";

/**
 * Competition mode with the phone locked (#539): the engine keeps ticking the
 * countdown every second, but the player screen must not re-render for it
 * until the app is in the foreground again.
 */
describe("useForegroundTimeRemaining (#539)", () => {
  let current: AppStateStatus = "active";
  let emit: (status: AppStateStatus) => void = () => {};

  beforeEach(() => {
    current = "active";
    Object.defineProperty(AppState, "currentState", {
      configurable: true,
      get: () => current,
    });
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_event, handler) => {
        emit = handler;
        return { remove: jest.fn() };
      });
    usePerformanceStore.getState().setTimeRemaining(90);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("follows the countdown in the foreground", async () => {
    const { result } = await renderHook(() => useForegroundTimeRemaining());
    expect(result.current).toBe(90);

    await act(() => usePerformanceStore.getState().setTimeRemaining(89));
    expect(result.current).toBe(89);
  });

  it("does not re-render on ticks while backgrounded, then resyncs", async () => {
    let renders = 0;
    const { result } = await renderHook(() => {
      renders += 1;
      return useForegroundTimeRemaining();
    });

    current = "background";
    await act(() => emit("background"));
    const backgroundRenders = renders;

    await act(() => {
      for (let t = 89; t >= 60; t -= 1) {
        usePerformanceStore.getState().setTimeRemaining(t);
      }
    });
    expect(renders).toBe(backgroundRenders);
    expect(result.current).toBe(90);
    // The engine still sees the real value.
    expect(usePerformanceStore.getState().timeRemaining).toBe(60);

    current = "active";
    await act(() => emit("active"));
    expect(result.current).toBe(60);
  });
});
