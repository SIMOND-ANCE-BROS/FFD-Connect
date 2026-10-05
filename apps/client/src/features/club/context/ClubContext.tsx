// Re-exports from Zustand store for backwards compatibility
export {
  useClubRepository,
  useClubStore,
  defaultClubRepository,
} from "../../../stores/club.store";
export type { ClubRepository, ClubMember } from "../../../stores/club.store";

import React, { ReactNode, useEffect } from "react";
import { useClubStore, type ClubRepository } from "../../../stores/club.store";

interface ClubProviderProps {
  children: ReactNode;
  implementation: ClubRepository;
}

export const ClubProvider: React.FC<ClubProviderProps> = ({
  children,
  implementation,
}) => {
  const setRepository = useClubStore((s) => s.setRepository);

  useEffect(() => {
    setRepository(implementation);
  }, [implementation, setRepository]);

  return <>{children}</>;
};
