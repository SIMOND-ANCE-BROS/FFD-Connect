import api from "../../../services/api";
import { createLogger } from "../../../utils/logger";
import { Competition } from "../../competitions/context/CompetitionContext";

const logger = createLogger("CheckinService");

export interface CheckinResponse {
  user: {
    firstName: string;
    lastName: string;
  };
  registrations: {
    event: string;
    status: "SUCCESS" | "ALREADY_CHECKED_IN" | "ERROR";
    message?: string;
    bibNumber?: number;
    partner?: string;
  }[];
  /**
   * Vérification du QR signé (#168). `warning` non nul = QR accepté mais non
   * vérifié (ancien QR, signature invalide, licence expirée) : à montrer au
   * staff. Absent sur un backend ancien.
   */
  qrVerification?: {
    mode: "off" | "warn" | "enforce";
    status:
      | "NOT_CHECKED"
      | "VALID"
      | "UNSIGNED"
      | "INVALID_SIGNATURE"
      | "EXPIRED";
    warning: string | null;
  };
}

export interface VolunteerTokenResponse {
  id: string;
  token: string;
  competitionId: string;
  expiresAt: string;
  name: string;
  accessUrl: string;
}

export const CheckinService = {
  checkIn: async (
    competitionId: string,
    qrData: string,
  ): Promise<CheckinResponse> => {
    const response = await api.post<CheckinResponse>(
      `/competitions/${competitionId}/checkin`,
      { qrData },
    );
    return response.data;
  },

  getActiveCompetition: async (): Promise<Competition | null> => {
    try {
      const response = await api.get<Competition>("/competitions/active");
      return response.data; // Can be null or object
    } catch (e) {
      logger.error("Failed to fetch active competition", e);
      return null;
    }
  },

  generateVolunteerToken: async (
    competitionId: string,
    name?: string,
  ): Promise<VolunteerTokenResponse> => {
    const response = await api.post<VolunteerTokenResponse>(
      `/competitions/${competitionId}/volunteer/token`,
      { name },
    );
    return response.data;
  },

  checkInAsVolunteer: async (
    competitionId: string,
    token: string,
    qrData: string,
  ): Promise<CheckinResponse> => {
    const response = await api.post<CheckinResponse>(
      "/competitions/checkin/volunteer",
      { competitionId, token, qrData },
    );
    return response.data;
  },
};
