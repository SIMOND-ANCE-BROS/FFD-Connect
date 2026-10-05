import type {
  ApiCompetition,
  ApiEvent,
  ApiRegistration,
  ApiResult,
  ApiScheduleItem,
  PaginatedResponse,
} from "@ffd-connect/shared";
import { create } from "zustand";
import api from "../services/api";
import { createLogger } from "../utils/logger";

const logger = createLogger("competition.store");

// Aliases locaux pour la rétrocompatibilité avec les composants existants
export type Competition = ApiCompetition;
export type Event = ApiEvent;
export type ScheduleItem = ApiScheduleItem;
export type Result = ApiResult;
export type CompetitionRegistration = ApiRegistration;

// Re-export des types utilitaires partagés
export type { PaginatedResponse };

export interface PaginationMeta {
  total: number;
  skip: number;
  take: number;
  hasMore: boolean;
}

/** Inscription en attente (club) avec user + event + competition */
export interface ClubPendingRegistration {
  id: string;
  eventId: string;
  userId: string;
  partnerName: string | null;
  status: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    clubName: string | null;
  };
  event: {
    id: string;
    category: string;
    ageGroup: string;
    competitionId: string;
  };
  competition: { id: string; title: string; date: string } | null;
}

export interface CompetitionRepository {
  syncCompetitions: () => Promise<{ jobId: string } | null>;
  getCompetitionDetails: (
    id: string,
  ) => Promise<Competition & { events: Event[]; schedule: ScheduleItem[] }>;
  /** Détail avec éligibilité par épreuve (utilisateur connecté, licencié). */
  getCompetitionDetailsForUser?: (
    id: string,
  ) => Promise<Competition & { events: Event[]; schedule: ScheduleItem[] }>;
  registerForEvent: (
    competitionId: string,
    eventId: string,
    partnerName?: string,
  ) => Promise<void>;
  getResults: (competitionId: string) => Promise<Result[]>;
  getEventRegistrations: (
    eventId: string,
  ) => Promise<CompetitionRegistration[]>;
  unregisterFromEvent: (
    competitionId: string,
    eventId: string,
  ) => Promise<void>;
  getUserRegistrations: () => Promise<CompetitionRegistration[]>;
  getCompetitions: (
    skip?: number,
    take?: number,
  ) => Promise<{
    data: Competition[];
    meta: PaginationMeta | { hasMore: boolean };
  }>;
  getClubPendingRegistrations: () => Promise<ClubPendingRegistration[]>;
  registerMember: (
    eventId: string,
    userId: string,
    partnerName?: string,
  ) => Promise<void>;
  confirmRegistration: (registrationId: string) => Promise<void>;
  unregisterMember: (eventId: string, userId: string) => Promise<void>;
}

export const defaultCompetitionRepository: CompetitionRepository = {
  getCompetitions: async (offset = 0, limit = 10) => {
    const res = await api.get<
      { data: Competition[]; meta: PaginationMeta } | Competition[]
    >(`/competitions?skip=${offset}&take=${limit}`);
    const resData = res.data as
      | { data?: Competition[]; meta?: PaginationMeta }
      | Competition[];
    return {
      data: (Array.isArray(resData) ? resData : resData.data) ?? [],
      meta:
        !Array.isArray(resData) && resData.meta
          ? resData.meta
          : { hasMore: false },
    };
  },

  syncCompetitions: async (): Promise<{ jobId: string } | null> => {
    try {
      const res = await api.post<{ jobId: string }>(`/competitions/sync`);
      logger.info("Sync job enqueued", { jobId: res.data.jobId });
      return { jobId: res.data.jobId };
    } catch (e) {
      logger.warn("Failed to sync competitions from FFD API", e);
      return null;
    }
  },

  getCompetitionDetails: async (id: string) => {
    const res = await api.get<
      Competition & { events: Event[]; schedule: ScheduleItem[] }
    >(`/competitions/${id}`);
    return res.data;
  },

  getCompetitionDetailsForUser: async (id: string) => {
    const res = await api.get<
      Competition & { events: Event[]; schedule: ScheduleItem[] }
    >(`/competitions/${id}/for-user`);
    return res.data;
  },

  registerForEvent: async (
    competitionId: string,
    eventId: string,
    partnerName?: string,
  ) => {
    await api.post(`/competitions/${competitionId}/register`, {
      eventId,
      partnerName,
    });
  },

  getResults: async (competitionId: string) => {
    const res = await api.get<Result[]>(
      `/competitions/${competitionId}/results`,
    );
    return res.data;
  },

  getEventRegistrations: async (eventId: string) => {
    const res = await api.get<CompetitionRegistration[]>(
      `/competitions/event/${eventId}/registrations`,
    );
    return res.data;
  },

  unregisterFromEvent: async (competitionId: string, eventId: string) => {
    await api.post(`/competitions/${competitionId}/unregister`, {
      eventId,
    });
  },

  getUserRegistrations: async () => {
    // userId comes from JWT token via backend
    const res = await api.get<CompetitionRegistration[]>(
      `/competitions/user/registrations`,
    );
    return res.data;
  },

  getClubPendingRegistrations: async () => {
    const res = await api.get<ClubPendingRegistration[]>(
      "/competitions/club/pending-registrations",
    );
    return res.data;
  },

  registerMember: async (
    eventId: string,
    userId: string,
    partnerName?: string,
  ) => {
    await api.post("/competitions/register-member", {
      eventId,
      userId,
      partnerName,
    });
  },

  confirmRegistration: async (registrationId: string) => {
    await api.post(`/competitions/registrations/${registrationId}/confirm`);
  },

  unregisterMember: async (eventId: string, userId: string) => {
    await api.post("/competitions/unregister-member", { eventId, userId });
  },
};

interface CompetitionStoreState {
  repository: CompetitionRepository;
  setRepository: (impl: CompetitionRepository) => void;
}

export const useCompetitionStore = create<CompetitionStoreState>((set) => ({
  repository: defaultCompetitionRepository,
  setRepository: (impl) => set({ repository: impl }),
}));

export const useCompetitionRepository = () =>
  useCompetitionStore((s) => s.repository);
