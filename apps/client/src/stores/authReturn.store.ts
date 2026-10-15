import { create } from "zustand";
import type { NotificationTarget } from "../features/settings/services/notificationTarget";

/** Screen (with its params) to reopen once the user has signed in. */
export type AuthReturnTarget = NotificationTarget;

/**
 * Where a guest was when they hit an action that needs an account (#20).
 *
 * A guest tapping « S'inscrire » on a competition leaves guest mode for the
 * Login screen; without this, a successful login or registration landed on
 * the home tab and the competition was lost. The navigator reopens `target`
 * once a real (non-guest) session starts, and drops it if the user goes back
 * to guest mode instead.
 *
 * Kept apart from `pendingDeepLink` (push notifications): that one is
 * consumed by any session, this one only by a signed-in account.
 * In memory only — an intent does not survive an app restart.
 */
interface AuthReturnState {
  target: AuthReturnTarget | null;
  setTarget: (target: AuthReturnTarget) => void;
  clear: () => void;
}

export const useAuthReturnStore = create<AuthReturnState>((set) => ({
  target: null,
  setTarget: (target) => set({ target }),
  clear: () => set({ target: null }),
}));
