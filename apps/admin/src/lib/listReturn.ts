import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

/**
 * Last query string of each back-office list (#562), so « Retour à la liste »
 * on a record page brings back the list as it was left: filters, sort, page
 * (the columns are remembered by the list itself). Per tab and per browser
 * session (sessionStorage), like the admin session; a tab opened on a record
 * goes back to the plain list.
 */
/**
 * sessionStorage that never throws (private window, blocked site data): the
 * list URLs are then remembered for this page load only, and a list never
 * breaks because of it.
 */
const safeSessionStorage: StateStorage = {
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

interface ListReturnState {
  searches: Record<string, string>;
  remember: (listPath: string, search: string) => void;
}

export const useListReturn = create<ListReturnState>()(
  persist(
    (set) => ({
      searches: {},
      remember: (listPath, search) =>
        set((state) =>
          state.searches[listPath] === search
            ? state
            : { searches: { ...state.searches, [listPath]: search } },
        ),
    }),
    {
      name: 'ffd-admin-list-return',
      storage: createJSONStorage(() => safeSessionStorage),
      partialize: ({ searches }) => ({ searches }),
    },
  ),
);

/** `?…` of a query string, or nothing for an empty one. */
const withQuestionMark = (search: string) =>
  search === '' || search.startsWith('?') ? search : `?${search}`;

/** URL of the list as last seen in this tab: `/users?f.role=in:CLUB&page=2`. */
export function useListReturnPath(listPath: string): string {
  const search = useListReturn((state) => state.searches[listPath] ?? '');
  return `${listPath}${withQuestionMark(search)}`;
}
