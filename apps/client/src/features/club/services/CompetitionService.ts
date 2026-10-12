import type {
  CreateCompetitionDto,
  UpdateCompetitionDto,
} from "../../../api/generated/types.gen";
import api from "../../../services/api";
import { Competition } from "../hooks/useClubCompetitionEditorLogic";

/** Bodies are the API DTOs (#417): build them with `competitionPayload`. */
export const CompetitionService = {
  /**
   * Create a new competition
   */
  create: async (data: CreateCompetitionDto): Promise<Competition> => {
    const response = await api.post<Competition>("/competitions", data);
    return response.data;
  },

  /**
   * Update an existing competition
   */
  update: async (
    id: string,
    data: UpdateCompetitionDto,
  ): Promise<Competition> => {
    const response = await api.patch<Competition>(`/competitions/${id}`, data);
    return response.data;
  },

  /**
   * Get competition by ID
   */
  getById: async (id: string): Promise<Competition> => {
    const response = await api.get<Competition>(`/competitions/${id}`);
    return response.data;
  },
};
