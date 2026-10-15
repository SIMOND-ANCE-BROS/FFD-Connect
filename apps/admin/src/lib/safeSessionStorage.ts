import type { StateStorage } from 'zustand/middleware';

/**
 * sessionStorage that never throws (private window, blocked site data, #577):
 * a persisted store then lives in memory for this page load only, and the
 * back-office never breaks because of it. Shared by every persisted admin
 * store (session, list return URLs).
 */
export const safeSessionStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.sessionStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.sessionStorage.setItem(name, value);
    } catch {
      // Not remembered across reloads; still applied in memory.
    }
  },
  removeItem: (name) => {
    try {
      window.sessionStorage.removeItem(name);
    } catch {
      // Same as above.
    }
  },
};
