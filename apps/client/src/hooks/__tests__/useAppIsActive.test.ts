import { act, renderHook } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { useAppIsActive } from "../useAppIsActive";

describe("useAppIsActive (#539)", () => {
  let emit: (status: AppStateStatus) => void;
  const remove = jest.fn();

  beforeEach(() => {
    remove.mockClear();
    Object.defineProperty(AppState, "currentState", {
      configurable: true,
      get: () => "active",
    });
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_event, handler) => {
        emit = handler;
        return { remove };
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("follows the foreground / background transitions", async () => {
    const { result, unmount } = await renderHook(() => useAppIsActive());
    expect(result.current).toBe(true);

    await act(() => emit("inactive"));
    expect(result.current).toBe(false);
    await act(() => emit("background"));
    expect(result.current).toBe(false);
    await act(() => emit("active"));
    expect(result.current).toBe(true);

    await act(() => unmount());
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
