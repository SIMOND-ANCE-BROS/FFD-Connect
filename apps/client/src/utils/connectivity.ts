import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";

/**
 * Shared, optimistic connectivity policy (#416): the device is offline only on
 * an explicit `false`. `isInternetReachable` is `null` while NetInfo probes
 * (and `isConnected` can be `null` at startup) — treated as online. A captive
 * portal (Wi-Fi connected, internet unreachable) counts as offline only once
 * NetInfo confirms it (`isInternetReachable === false`).
 */
export function isNetStateOnline(
  state: Pick<NetInfoState, "isConnected" | "isInternetReachable">,
): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

/** Past this, stop waiting for NetInfo and fall back to optimism. */
const NETINFO_FETCH_TIMEOUT_MS = 1000;

/**
 * Non-React counterpart of `useIsOnline`: `true` only when NetInfo confirms
 * there is no network. Optimistic when NetInfo throws or is slow, so a caller
 * is never blocked on a network probe.
 */
export async function isDeviceOffline(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const state = await Promise.race([
      NetInfo.fetch(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), NETINFO_FETCH_TIMEOUT_MS);
      }),
    ]);
    return state != null && !isNetStateOnline(state);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
