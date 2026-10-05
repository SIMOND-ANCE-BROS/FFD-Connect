import api from "../../../services/api";
import { Competition } from "../hooks/useClubCompetitionEditorLogic";

export const CompetitionService = {
  /**
   * Create a new competition
   */
  create: async (data: Omit<Competition, "id">): Promise<Competition> => {
    const response = await api.post<Competition>("/competitions", data);
    return response.data;
  },

  /**
   * Update an existing competition
   */
  update: async (
    id: string,
    data: Partial<Competition>,
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
