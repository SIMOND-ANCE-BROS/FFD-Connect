import { useCallback } from "react";
import { useAuthRepository } from "../features/auth/context/AuthContext";
import { useAuthStore } from "../stores/auth.store";
import {
  type AuthReturnTarget,
  useAuthReturnStore,
} from "../stores/authReturn.store";
import { createLogger } from "../utils/logger";

const logger = createLogger("authReturn");

export type AuthReturnStep = "wait" | "drop" | "navigate";

/**
 * What the navigator does with a pending return target (#20).
 *
 * - no target, or signed out (Login/Register shown) → wait;
 * - back in guest mode (« Continuer en invité ») → drop: the guest gave up
 *   signing in, reopening the screen later would be a surprise;
 * - signed in with an account → navigate.
 */
export function nextAuthReturnStep(
  isLoggedIn: boolean | null,
  isGuest: boolean,
  target: AuthReturnTarget | null,
): AuthReturnStep {
  if (!target || !isLoggedIn) return "wait";
  return isGuest ? "drop" : "navigate";
}

/**
 * Leaves guest mode for the Login screen, remembering `target` so that a
 * successful login or registration reopens it (#20).
 *
 * The target is stored AFTER the session switch: while the guest session is
 * still live the navigator would read it as « back in guest mode » and drop it.
 */
export function useSignInAndReturn(): (
  target: AuthReturnTarget,
) => Promise<void> {
  const auth = useAuthRepository();
  const refreshAuth = useAuthStore((s) => s.refreshAuth);
  const setTarget = useAuthReturnStore((s) => s.setTarget);

  return useCallback(
    async (target: AuthReturnTarget) => {
      try {
        await auth.logout();
        await refreshAuth();
        setTarget(target);
      } catch (error) {
        logger.error("Could not leave guest mode to sign in", error);
      }
    },
    [auth, refreshAuth, setTarget],
  );
}
