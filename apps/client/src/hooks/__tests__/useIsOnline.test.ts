import { renderHook, act } from "@testing-library/react-native";
import { useIsOnline } from "../useIsOnline";

type NetState = {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
};

jest.mock("@react-native-community/netinfo", () => ({
  addEventListener: jest.fn(() => jest.fn()),
}));

const NetInfo = require("@react-native-community/netinfo");

function captureListener(): (state: NetState) => void {
  let cb: ((state: NetState) => void) | null = null;
  NetInfo.addEventListener.mockImplementation(
    (fn: (state: NetState) => void) => {
      cb = fn;
      return jest.fn();
    },
  );
  return (state: NetState) => cb?.(state);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useIsOnline", () => {
  it("defaults to online (optimistic)", async () => {
    const { result } = await renderHook(() => useIsOnline());
    expect(result.current).toBe(true);
  });

  it("subscribes to NetInfo and unsubscribes on unmount", async () => {
    const unsubscribe = jest.fn();
    NetInfo.addEventListener.mockReturnValue(unsubscribe);

    const { unmount } = await renderHook(() => useIsOnline());
    expect(NetInfo.addEventListener).toHaveBeenCalledTimes(1);

    await unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("goes offline when isConnected is false", async () => {
    const emit = captureListener();
    const { result } = await renderHook(() => useIsOnline());

    await act(() => emit({ isConnected: false, isInternetReachable: true }));
    expect(result.current).toBe(false);
  });

  it("goes offline when internet is not reachable", async () => {
    const emit = captureListener();
    const { result } = await renderHook(() => useIsOnline());

    await act(() => emit({ isConnected: true, isInternetReachable: false }));
    expect(result.current).toBe(false);
  });

  it("stays online when reachability is unknown (null)", async () => {
    const emit = captureListener();
    const { result } = await renderHook(() => useIsOnline());

    await act(() => emit({ isConnected: true, isInternetReachable: null }));
    expect(result.current).toBe(true);
  });

  it("comes back online after a full connection is confirmed", async () => {
    const emit = captureListener();
    const { result } = await renderHook(() => useIsOnline());

    await act(() => emit({ isConnected: false, isInternetReachable: false }));
    expect(result.current).toBe(false);

    await act(() => emit({ isConnected: true, isInternetReachable: true }));
    expect(result.current).toBe(true);
  });
});
