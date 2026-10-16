import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeSessionStorage } from './safeSessionStorage';

/**
 * Last query string of each back-office list (#562), so « Retour à la liste »
 * on a record page brings back the list as it was left: filters, sort, page
 * (the columns are remembered by the list itself). Per tab and per browser
 * session (sessionStorage), like the admin session; a tab opened on a record
 * goes back to the plain list.
 */

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
