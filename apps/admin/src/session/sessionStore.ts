import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

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

interface SessionState {
  accessToken: string | null;
  refreshToken: string | null;
  user: SessionUser | null;
  setSession: (s: { accessToken: string; refreshToken: string; user: SessionUser }) => void;
  clear: () => void;
}

/**
 * Admin session. sessionStorage on purpose: closing the tab ends the session.
 * Never localStorage (it outlives the browser session).
 */
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setSession: ({ accessToken, refreshToken, user }) => set({ accessToken, refreshToken, user }),
      clear: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    {
      name: 'ffd-admin-session',
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ accessToken, refreshToken, user }) => ({
        accessToken,
        refreshToken,
        user,
      }),
    },
  ),
);
