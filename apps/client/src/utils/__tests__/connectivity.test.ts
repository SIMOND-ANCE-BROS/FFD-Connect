import NetInfo from "@react-native-community/netinfo";
import { isDeviceOffline, isNetStateOnline } from "../connectivity";

const mockFetch = NetInfo.fetch as jest.Mock;

describe("isNetStateOnline", () => {
  it.each([
    [true, true, true],
    [true, null, true], // reachability still probing → optimistic
    [null, null, true], // startup, nothing known yet → optimistic
    [false, true, false],
    [false, null, false],
    [true, false, false], // captive portal confirmed by NetInfo
  ])(
    "isConnected=%s isInternetReachable=%s → online=%s",
    (isConnected, isInternetReachable, expected) => {
      expect(isNetStateOnline({ isConnected, isInternetReachable })).toBe(
        expected,
      );
    },
  );
});

describe("isDeviceOffline", () => {
  afterEach(() => {
    jest.useRealTimers();
    mockFetch.mockReset();
  });

  it("is true when NetInfo confirms there is no network", async () => {
    mockFetch.mockResolvedValue({
      isConnected: false,
      isInternetReachable: false,
    });
    await expect(isDeviceOffline()).resolves.toBe(true);
  });

  it("is true behind a captive portal (connected, unreachable)", async () => {
    mockFetch.mockResolvedValue({
      isConnected: true,
      isInternetReachable: false,
    });
    await expect(isDeviceOffline()).resolves.toBe(true);
  });

  it("is false when reachability is unknown", async () => {
    mockFetch.mockResolvedValue({
      isConnected: true,
      isInternetReachable: null,
    });
    await expect(isDeviceOffline()).resolves.toBe(false);
  });

  it("is optimistic when NetInfo throws", async () => {
    mockFetch.mockRejectedValue(new Error("native module missing"));
    await expect(isDeviceOffline()).resolves.toBe(false);
  });

  it("is optimistic when NetInfo does not answer in time", async () => {
    jest.useFakeTimers();
    mockFetch.mockReturnValue(new Promise(() => {}));
    const result = isDeviceOffline();
    jest.advanceTimersByTime(1000);
    await expect(result).resolves.toBe(false);
  });
});
