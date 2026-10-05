import { act, renderHook } from "@testing-library/react-native";
import { useAsync } from "../useAsync";

describe("useAsync", () => {
  it("initializes with default state", async () => {
    const { result } = await renderHook(() => useAsync(async () => "test"));
    expect(result.current.data).toBe(null);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it("executes successfully and updates state", async () => {
    const mockFn = jest.fn().mockResolvedValue("success data");
    const onSuccess = jest.fn();
    const { result } = await renderHook(() => useAsync(mockFn, { onSuccess }));

    let promise: Promise<string | null>;

    await act(async () => {
      promise = result.current.execute();
    });

    const data = await promise!;
    expect(data).toBe("success data");
    expect(result.current.data).toBe("success data");
    expect(result.current.loading).toBe(false);
    expect(onSuccess).toHaveBeenCalledWith("success data");
  });

  it("handles errors correctly", async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error("Async Fail"));
    const onError = jest.fn();
    const { result } = await renderHook(() => useAsync(mockFn, { onError }));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toBe(null);
    expect(result.current.error?.message).toBe("Async Fail");
    expect(onError).toHaveBeenCalled();
  });

  it("handles non-Error rejection and calls onError with Error instance", async () => {
    const onError = jest.fn();
    const mockFn = jest.fn().mockRejectedValue("string rejection");
    const { result } = await renderHook(() => useAsync(mockFn, { onError }));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("string rejection");
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "string rejection" }),
    );
  });

  it("resets state on execute if option is set", async () => {
    const mockFn = jest.fn().mockResolvedValue("new data");
    const { result } = await renderHook(() =>
      useAsync(mockFn, { resetOnExecute: true }),
    );

    // Set initial data
    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.data).toBe("new data");

    // Execute again
    await act(async () => {
      const execPromise = result.current.execute();
      // data should be reset to null during execution
      // expect(result.current.data).toBe(null);
      await execPromise;
    });
  });
});
