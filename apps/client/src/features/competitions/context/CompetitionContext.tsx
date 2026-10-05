// Re-exports from Zustand store for backwards compatibility
export {
  useCompetitionRepository,
  useCompetitionStore,
  defaultCompetitionRepository,
} from "../../../stores/competition.store";
export type {
  CompetitionRepository,
  Competition,
  Event,
  ScheduleItem,
  Result,
  CompetitionRegistration,
  PaginationMeta,
  ClubPendingRegistration,
  PaginatedResponse,
} from "../../../stores/competition.store";

import React, { useEffect } from "react";
import {
  useCompetitionStore,
  type CompetitionRepository,
} from "../../../stores/competition.store";

/** Backwards-compatible provider. Sets the repository implementation in the Zustand store. */
export const CompetitionProvider: React.FC<{
  children: React.ReactNode;
  implementation?: CompetitionRepository;
}> = ({ children, implementation }) => {
  const setRepository = useCompetitionStore((s) => s.setRepository);

  useEffect(() => {
    if (implementation) {
      setRepository(implementation);
    }
  }, [implementation, setRepository]);

  return <>{children}</>;
};
