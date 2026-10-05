/**
 * React Query key factory.
 *
 * Centralizes all query keys to prevent typo-induced cache misses.
 * Use these instead of inline string arrays:
 *
 *   // Before
 *   queryKey: ["competition", id]
 *
 *   // After
 *   queryKey: queryKeys.competitions.detail(id)
 */

export const queryKeys = {
  competitions: {
    all: ["competitions"] as const,
    detail: (id: string, role?: string) =>
      role
        ? (["competition", id, role] as const)
        : (["competition", id] as const),
    registrants: (eventId: string) => ["eventRegistrants", eventId] as const,
  },
  registrations: {
    my: ["myRegistrations"] as const,
  },
  club: {
    members: ["clubMembers"] as const,
    registrationMode: ["clubRegistrationMode"] as const,
    myRegistrationMode: ["myClubRegistrationMode"] as const,
    pendingRegistrations: ["clubPendingRegistrations"] as const,
    partnerships: (activeOnly?: boolean) =>
      activeOnly !== undefined
        ? (["clubPartnerships", activeOnly] as const)
        : (["clubPartnerships"] as const),
    partnershipClubs: ["clubPartnershipClubs"] as const,
    soloTeams: {
      all: ["clubSoloTeams"] as const,
      detail: (teamId: string) => ["clubSoloTeam", teamId] as const,
    },
  },
} as const;
