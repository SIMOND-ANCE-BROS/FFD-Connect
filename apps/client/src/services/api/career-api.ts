import { BACKEND_URL } from "../../config";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import { httpGet } from "../../utils/httpInterceptor";

export interface CareerPartnership {
  id: string;
  status: string;
  startDate: string;
  endDate: string | null;
  partner: {
    id: string;
    firstName: string;
    lastName: string;
    clubName: string | null;
  };
  clubName: string;
  secondaryClubName: string | null;
  isCurrent: boolean;
}

export interface CareerRegistration {
  id: string;
  status: string;
  bibNumber: number | null;
  partnerName: string | null;
  event: {
    id: string;
    category: string;
    ageGroup: string;
    level: string | null;
  };
  competition: {
    id: string;
    title: string;
    date: string;
    location: string;
    status: string;
  };
}

export interface CareerResult {
  id: string;
  eventId: string;
  round: string;
  ranking: number;
  /** Nombre total de participants (pour "Xe sur Y"). */
  totalParticipants?: number | null;
  participantLabel: string | null;
  event: { category: string; ageGroup: string };
  competition: { id: string; title: string; date: string };
}

export interface CareerResponse {
  partnerships: CareerPartnership[];
  registrations: CareerRegistration[];
  results: CareerResult[];
}

export interface CareerSearchMember {
  id: string;
  firstName: string;
  lastName: string;
  clubName: string | null;
}

export const CareerApi = {
  async getMyCareer(token: string): Promise<CareerResponse> {
    return httpGet<CareerResponse>(`${BACKEND_URL}/career/me`, {
      headers: { Authorization: `Bearer ${token}` },
      errorMessage: ERROR_MESSAGES.LOADING_FAILED,
      logErrors: true,
    });
  },

  async getUserCareer(token: string, userId: string): Promise<CareerResponse> {
    return httpGet<CareerResponse>(`${BACKEND_URL}/career/user/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
      errorMessage: ERROR_MESSAGES.LOADING_FAILED,
      logErrors: true,
    });
  },

  async searchCareerMembers(
    token: string,
    q: string,
  ): Promise<CareerSearchMember[]> {
    if (!q.trim() || q.trim().length < 2) return [];
    const params = new URLSearchParams({ q: q.trim() });
    return httpGet<CareerSearchMember[]>(
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      `${BACKEND_URL}/career/search-members?${params}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        errorMessage: ERROR_MESSAGES.LOADING_FAILED,
        logErrors: true,
      },
    );
  },
};
