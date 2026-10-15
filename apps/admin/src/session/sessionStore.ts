import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeSessionStorage } from '../lib/safeSessionStorage';

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Main role. */
  role: string;
  /** Main + extra roles (lot 1c). Missing in a session saved before lot 1c. */
  roles?: string[];
}

/** Rights are cumulative: ADMIN as main or extra role opens the back-office. */
export function isAdmin(user: SessionUser | null | undefined): boolean {
  return user ? (user.roles ?? [user.role]).includes('ADMIN') : false;
}

export interface SessionSnapshot {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}

interface SessionState {
  accessToken: string | null;
  refreshToken: string | null;
  user: SessionUser | null;
  /**
   * True while a fresh tab asks the other back-office tabs for their session
   * (#669, `sessionSync.ts`). Never persisted.
   */
  restoring: boolean;
  setSession: (s: SessionSnapshot) => void;
  clear: () => void;
}

/**
 * Admin session. sessionStorage on purpose: closing the tab ends the session;
 * a tab opened from another one gets it over BroadcastChannel (#669).
 * Never localStorage (it outlives the browser session). Blocked storage keeps
 * the session in memory for the tab (#577).
 */
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      restoring: false,
      setSession: ({ accessToken, refreshToken, user }) => set({ accessToken, refreshToken, user }),
      clear: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    {
      name: 'ffd-admin-session',
      storage: createJSONStorage(() => safeSessionStorage),
      partialize: ({ accessToken, refreshToken, user }) => ({
        accessToken,
        refreshToken,
        user,
      }),
    },
  ),
);
