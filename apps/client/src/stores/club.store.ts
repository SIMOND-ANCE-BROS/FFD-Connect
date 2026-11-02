import { useCallback } from "react";
import { create } from "zustand";
import { AuthService } from "../features/auth/services/AuthService";
import { ClubService } from "../features/club/services/ClubService";
import { onSessionEnd } from "../services/sessionCleanup";
import { useAuthStore } from "./auth.store";

export type { ClubMember } from "../features/club/services/ClubService";

import type { ClubMember } from "../features/club/services/ClubService";

export interface ClubRepository {
  getMembers(): Promise<ClubMember[]>;
  checkEligibility(
    member: ClubMember,
    event: { ageGroup: string; category: string },
  ): boolean;
}

interface ClubStoreState {
  repository: ClubRepository;
  setRepository: (impl: ClubRepository) => void;
  clubLogoUri: string | null;
  setClubLogoUri: (uri: string | null) => void;
}

export const defaultClubRepository: ClubRepository = {
  getMembers: async () => {
    return ClubService.getMembers();
  },
  checkEligibility: (member, event) => {
    return ClubService.checkEligibility(member, event);
  },
};

export const useClubStore = create<ClubStoreState>((set) => ({
  repository: defaultClubRepository,
  setRepository: (impl) => set({ repository: impl }),
  clubLogoUri: null,
  setClubLogoUri: (uri) => set({ clubLogoUri: uri }),
}));

// Identity change (#879): the previous account's club logo leaves the tab
// bar with the rest of its session, at a logout and at both ends of a support
// access.
onSessionEnd(() => useClubStore.getState().setClubLogoUri(null));

/** Hook replacement for useClubRepository() */
export const useClubRepository = () => useClubStore((s) => s.repository);

/** Load club logo from persisted auth config into the store */
export async function initClubLogo(): Promise<void> {
  try {
    const config = await AuthService.getAuthConfig();
    // The current session's logo, or none: never the previous account's.
    useClubStore.getState().setClubLogoUri(config.clubLogoUri ?? null);
  } catch {
    // Ignore — logo is non-critical
  }
}

/**
 * Every switch (login, biometric unlock, both ends of a support access,
 * logout) ends with refreshAuth(): reload the logo of the session now in
 * place, the session-end reset above having cleared the previous one.
 * Started once by the app root; returns the unsubscribe.
 */
export function watchClubLogo(): () => void {
  return useAuthStore.subscribe((state, previous) => {
    if (
      state.isLoggedIn !== previous.isLoggedIn ||
      state.impersonating !== previous.impersonating ||
      state.impersonatedName !== previous.impersonatedName
    ) {
      void initClubLogo();
    }
  });
}

/** Hook replacement for useClubLogo() from ClubLogoContext */
export const useClubLogo = () => {
  const clubLogoUri = useClubStore((s) => s.clubLogoUri);
  const setClubLogoUri = useClubStore((s) => s.setClubLogoUri);

  const setClubLogo = useCallback(
    async (uri: string | null) => {
      await AuthService.setClubLogo(uri);
      setClubLogoUri(uri);
    },
    [setClubLogoUri],
  );

  return { clubLogoUri, setClubLogo };
};
