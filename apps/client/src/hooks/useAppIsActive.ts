import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

const isActive = (status: AppStateStatus | null | undefined): boolean =>
  // `null`/unknown at cold start counts as active: never hide UI by mistake.
  status == null || status === "active";

/**
 * Whether the app is in the foreground. Use it to stop purely visual work
 * (JS-driven animations, UI tickers) while the app is backgrounded or the
 * phone is locked: iOS kills an app that keeps the CPU above 80 % for a
 * minute in the background, even while it legitimately plays audio (#539).
 */
export function useAppIsActive(): boolean {
  const [active, setActive] = useState(() => isActive(AppState.currentState));
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status) => {
      setActive(isActive(status));
    });
    return () => sub.remove();
  }, []);
  return active;
}
