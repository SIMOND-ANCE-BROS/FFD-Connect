import api from "../../../services/api";

/** Mode d'inscription du club (backend: ClubRegistrationMode) */
export type ClubRegistrationMode =
  | "CLUB_AND_MEMBERS_PENDING"
  | "CLUB_ONLY"
  | "MEMBERS_AUTO_CONFIRM";

export interface HelloAssoStatus {
  clubName: string;
  helloAssoConnected: boolean;
  organizationSlug: string | null;
  registrationMode?: ClubRegistrationMode;
}

export interface ConnectHelloAssoParams {
  clientId: string;
  clientSecret: string;
  organizationSlug: string;
}

export interface ClubMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  category?: string;
  ageGroup?: string;
  competitionLevel?: string | null;
  clubName?: string | null;
  license?: { number: string | null; validUntil: Date | null };
  partnerName?: string;
  passportLevelLatin?: string | null;
  passportLevelStandard?: string | null;
  /** Données WDSF si le membre a lié sa licence WDSF (MIN, nationalité, type, âge, expiration). */
  wdsf?: {
    min: string;
    nationality?: string | null;
    licenseType?: string | null;
    ageGroup?: string | null;
    expiresOn?: string | null;
  } | null;
}

export type PartnershipStatus = "PENDING_SECOND_CLUB" | "ACTIVE" | "REJECTED";
export type PartnershipManagementMode =
  | "PRIMARY_ONLY"
  | "SECONDARY_ONLY"
  | "BOTH";

export interface Partnership {
  id: string;
  clubId: string;
  secondaryClubId: string | null;
  user1Id: string;
  user2Id: string;
  startDate: string;
  endDate: string | null;
  status: PartnershipStatus;
  managementMode: PartnershipManagementMode;
  user1: { id: string; firstName: string; lastName: string; email?: string };
  user2: { id: string; firstName: string; lastName: string; email?: string };
  secondaryClub?: { id: string; name: string } | null;
}

export interface ClubOption {
  id: string;
  name: string;
}

export interface SoloTeamMember {
  id: string;
  userId: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    competitionLevel?: string | null;
  };
}

export interface SoloTeam {
  id: string;
  clubId: string;
  name: string;
  level: string;
  members: SoloTeamMember[];
}

interface MembersResponse {
  data: ClubMember[];
  meta: { total: number; skip: number; take: number; hasMore: boolean };
}

/** Options pour récupérer les membres (même API que la liste "Membres du club"). */
export interface GetMembersOptions {
  take?: number;
  skip?: number;
}

export const ClubService = {
  /**
   * Liste des membres du club (même source que l'écran "Membres").
   * Pour la modal "Créer un couple" en mono-club, utiliser getMembers({ take: 100 }) pour avoir la même liste.
   */
  getMembers(options?: GetMembersOptions): Promise<ClubMember[]> {
    const params = new URLSearchParams();
    if (options?.take != null) params.set("take", String(options.take));
    if (options?.skip != null) params.set("skip", String(options.skip));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return api
      .get<MembersResponse>(`/users/members${qs}`)
      .then((r) => r.data.data);
  },

  getMembersForPartnership(secondaryClubId?: string): Promise<ClubMember[]> {
    const qs = secondaryClubId ? `?secondaryClubId=${secondaryClubId}` : "";
    return api
      .get<ClubMember[]>(`/clubs/me/partnerships/members${qs}`)
      .then((r) => r.data);
  },

  checkEligibility(
    member: ClubMember,
    filter: {
      category?: string;
      ageGroup?: string;
      level?: string | null;
      eventKind?: string;
    },
  ): boolean {
    if (
      filter.category != null &&
      filter.category !== "" &&
      member.category !== filter.category
    ) {
      return false;
    }
    if (
      filter.ageGroup != null &&
      filter.ageGroup !== "" &&
      member.ageGroup !== filter.ageGroup
    ) {
      return false;
    }
    if (
      filter.eventKind === "CLASSIFICATRICE" &&
      filter.level != null &&
      filter.level !== "" &&
      member.competitionLevel !== filter.level
    ) {
      return false;
    }
    return true;
  },

  getHelloAssoStatus(): Promise<HelloAssoStatus> {
    return api.get<HelloAssoStatus>("/clubs/me/helloasso").then((r) => r.data);
  },

  connectHelloAsso(
    params: ConnectHelloAssoParams,
  ): Promise<{ clubName: string; helloAssoConnected: true }> {
    return api
      .put<{
        clubName: string;
        helloAssoConnected: true;
      }>("/clubs/me/helloasso", params)
      .then((r) => r.data);
  },

  setRegistrationMode(
    mode: ClubRegistrationMode,
  ): Promise<{ clubName: string; registrationMode: ClubRegistrationMode }> {
    return api
      .patch<{
        clubName: string;
        registrationMode: ClubRegistrationMode;
      }>("/clubs/me/registration-mode", { registrationMode: mode })
      .then((r) => r.data);
  },

  /** Mode d'inscription du club du licencié (pour afficher ou masquer « S'inscrire »). */
  getMyClubRegistrationMode(): Promise<{
    registrationMode: ClubRegistrationMode | null;
  }> {
    return api
      .get<{
        registrationMode: ClubRegistrationMode | null;
      }>("/clubs/me/registration-mode")
      .then((r) => r.data);
  },

  getPartnerships(
    activeOnly = true,
  ): Promise<{ partnerships: Partnership[]; myClubId: string }> {
    return api
      .get<{
        partnerships: Partnership[];
        myClubId: string;
      }>(`/clubs/me/partnerships?activeOnly=${activeOnly}`)
      .then((r) => r.data);
  },

  /** Réponse à la création d'un couple : partenariat + tranche d'âge calculée et conseils niveau/type de danse. */
  createPartnership(data: {
    user1Id: string;
    user2Id: string;
    secondaryClubId?: string;
    managementMode?: PartnershipManagementMode;
    startDate?: string;
  }): Promise<{
    partnership: Partnership;
    coupleAgeGroup: string | null;
    suggestedLevel: string | null;
    suggestedCategories: string[];
  }> {
    return api
      .post<{
        partnership: Partnership;
        coupleAgeGroup: string | null;
        suggestedLevel: string | null;
        suggestedCategories: string[];
      }>("/clubs/me/partnerships", data)
      .then((r) => r.data);
  },

  endPartnership(id: string, endDate: string): Promise<Partnership> {
    return api
      .patch<Partnership>(`/clubs/me/partnerships/${id}/end`, { endDate })
      .then((r) => r.data);
  },

  getClubsForPartnership(): Promise<ClubOption[]> {
    return api
      .get<ClubOption[]>("/clubs/me/partnerships/clubs")
      .then((r) => r.data);
  },

  validatePartnership(id: string, accepted: boolean): Promise<Partnership> {
    return api
      .patch<Partnership>(`/clubs/me/partnerships/${id}/validate`, { accepted })
      .then((r) => r.data);
  },

  getSoloTeams(): Promise<SoloTeam[]> {
    return api.get<SoloTeam[]>("/clubs/me/solo-teams").then((r) => r.data);
  },

  createSoloTeam(data: {
    name: string;
    level: "Débutant" | "Intermédiaire";
  }): Promise<SoloTeam> {
    return api.post<SoloTeam>("/clubs/me/solo-teams", data).then((r) => r.data);
  },

  getSoloTeam(id: string): Promise<SoloTeam> {
    return api.get<SoloTeam>(`/clubs/me/solo-teams/${id}`).then((r) => r.data);
  },

  addSoloTeamMember(teamId: string, userId: string): Promise<SoloTeam> {
    return api
      .post<SoloTeam>(`/clubs/me/solo-teams/${teamId}/members`, { userId })
      .then((r) => r.data);
  },

  removeSoloTeamMember(teamId: string, userId: string): Promise<SoloTeam> {
    return api
      .delete<SoloTeam>(`/clubs/me/solo-teams/${teamId}/members/${userId}`)
      .then((r) => r.data);
  },
};
