import { act, renderHook } from "@testing-library/react-native";
import { Alert } from "react-native";
import { useErrorHandler } from "../useErrorHandler";

jest.mock("../../utils/logger", () => {
  const logger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };
  return { createLogger: () => logger };
});

describe("useErrorHandler", () => {
  it("handles errors by logging and potentially showing alert", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { result } = await renderHook(() => useErrorHandler());

    const error = new Error("Test Error");
    await act(() => {
      result.current.handleError(error, { showAlert: true });
    });

    expect(alertSpy).toHaveBeenCalledWith("Erreur", "Test Error");
    alertSpy.mockRestore();
  });

  it("calls onError callback", async () => {
    const onError = jest.fn();
    const { result } = await renderHook(() => useErrorHandler());

    const error = new Error("Test Error");
    await act(() => {
      result.current.handleError(error, { onError });
    });

    expect(onError).toHaveBeenCalledWith(error);
  });

  it("wraps async functions with withErrorHandling", async () => {
    const { result } = await renderHook(() => useErrorHandler());
    const mockFn = jest.fn().mockRejectedValue(new Error("Async Fail"));

    let value: unknown;
    await act(async () => {
      value = await result.current.withErrorHandling(mockFn);
    });

    expect(value).toBeNull();
    expect(mockFn).toHaveBeenCalled();
  });

  it("manages loading and error handling together", async () => {
    const { result } = await renderHook(() => useErrorHandler());
    const setLoading = jest.fn();
    const mockFn = jest.fn().mockRejectedValue(new Error("Loading Fail"));

    await act(async () => {
      await result.current.withLoadingAndErrorHandling(mockFn, setLoading);
    });

    expect(setLoading).toHaveBeenCalledWith(true);
    expect(setLoading).toHaveBeenCalledWith(false);
    expect(mockFn).toHaveBeenCalled();
  });

  it("uses userMessage in alert when showAlert is true", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { result } = await renderHook(() => useErrorHandler());

    await act(() => {
      result.current.handleError(new Error("raw"), {
        showAlert: true,
        userMessage: "Message for user",
      });
    });

    expect(alertSpy).toHaveBeenCalledWith("Erreur", "Message for user");
    alertSpy.mockRestore();
  });

  it("does not log when logError is false", async () => {
    const logger = require("../../utils/logger").createLogger();
    logger.error.mockClear();
    const { result } = await renderHook(() => useErrorHandler());

    await act(() => {
      result.current.handleError(new Error("no log"), { logError: false });
    });

    expect(logger.error).not.toHaveBeenCalled();
  });

  it("wraps non-Error in Error for handleError", async () => {
    const onError = jest.fn();
    const { result } = await renderHook(() => useErrorHandler());

    await act(() => {
      result.current.handleError("string error", { onError });
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "string error" }),
    );
  });
});
