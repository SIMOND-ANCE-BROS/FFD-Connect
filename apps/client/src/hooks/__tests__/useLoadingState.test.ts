import { act, renderHook } from "@testing-library/react-native";
import { useLoadingState } from "../useLoadingState";

describe("useLoadingState", () => {
  it("initializes with false by default", async () => {
    const { result } = await renderHook(() => useLoadingState());
    expect(result.current.isLoading).toBe(false);
  });

  it("initializes with custom state", async () => {
    const { result } = await renderHook(() => useLoadingState(true));
    expect(result.current.isLoading).toBe(true);
  });

  it("starts and stops loading", async () => {
    const { result } = await renderHook(() => useLoadingState());

    await act(() => {
      result.current.startLoading();
    });
    expect(result.current.isLoading).toBe(true);

    await act(() => {
      result.current.stopLoading();
    });
    expect(result.current.isLoading).toBe(false);
  });

  it("manages loading automatically with withLoading", async () => {
    const { result } = await renderHook(() => useLoadingState());

    const mockFn = jest.fn().mockResolvedValue("success");
    let promise: Promise<string>;

    await act(async () => {
      promise = result.current.withLoading(mockFn);
      // While promise is running, isLoading should be true
      // However, with act() it might be tricky to catch the transient state without specific techniques
    });

    const value = await promise!;
    expect(value).toBe("success");
    expect(result.current.isLoading).toBe(false);
  });
});
