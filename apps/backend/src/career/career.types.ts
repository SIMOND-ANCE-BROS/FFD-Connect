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
  /** Nombre total de participants à l'épreuve (pour afficher "Xe sur Y"). */
  totalParticipants: number | null;
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
