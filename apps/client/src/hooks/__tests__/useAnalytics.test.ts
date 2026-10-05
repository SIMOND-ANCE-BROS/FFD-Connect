import { renderHook, act } from "@testing-library/react-native";
import { useAnalytics } from "../useAnalytics";
import { analytics } from "../../services/analytics";

jest.mock("../../services/analytics", () => ({
  analytics: {
    logEvent: jest.fn(),
    logScreenView: jest.fn(),
  },
}));

const mockAnalytics = analytics as jest.Mocked<typeof analytics>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useAnalytics", () => {
  it("forwards logEvent to the analytics service", async () => {
    const { result } = await renderHook(() => useAnalytics());

    await act(() => {
      result.current.logEvent("track_play" as never, { id: "1" });
    });

    expect(mockAnalytics.logEvent).toHaveBeenCalledWith("track_play", {
      id: "1",
    });
  });

  it("forwards logEvent without params", async () => {
    const { result } = await renderHook(() => useAnalytics());

    await act(() => {
      result.current.logEvent("app_open" as never);
    });

    expect(mockAnalytics.logEvent).toHaveBeenCalledWith("app_open", undefined);
  });

  it("forwards logScreenView to the analytics service", async () => {
    const { result } = await renderHook(() => useAnalytics());

    await act(() => {
      result.current.logScreenView("Home", { foo: "bar" });
    });

    expect(mockAnalytics.logScreenView).toHaveBeenCalledWith("Home", {
      foo: "bar",
    });
  });

  it("returns stable callback references across renders", async () => {
    const { result, rerender } = await renderHook(() => useAnalytics());
    const first = result.current;

    await rerender({});

    expect(result.current.logEvent).toBe(first.logEvent);
    expect(result.current.logScreenView).toBe(first.logScreenView);
  });
});
