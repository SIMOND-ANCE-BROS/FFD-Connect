import { useCallback } from "react";
import { create } from "zustand";
import { AuthService } from "../features/auth/services/AuthService";
import { ClubService } from "../features/club/services/ClubService";

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

/** Hook replacement for useClubRepository() */
export const useClubRepository = () => useClubStore((s) => s.repository);

/** Load club logo from persisted auth config into the store */
export async function initClubLogo(): Promise<void> {
  try {
    const config = await AuthService.getAuthConfig();
    if (config.clubLogoUri) {
      useClubStore.getState().setClubLogoUri(config.clubLogoUri);
    }
  } catch {
    // Ignore — logo is non-critical
  }
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
