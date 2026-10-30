import type { ID } from "@ffd-connect/shared";
import type { NavigatorScreenParams } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ClubMember } from "../features/club/services/ClubService";
import { Competition } from "../features/competitions/context/CompetitionContext";

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  // `role` / `isGuest`: legacy fallback (MainTabs reads the auth store).
  // Nested tab params open a given tab, e.g. Career from a competition
  // (#858). React Navigation applies them once: tabs re-mounted by a
  // profile switch start on their first tab again (navigation/__tests__/
  // popToTab.test.tsx).
  Main:
    | ({ role?: string; isGuest?: boolean } & Partial<
        NavigatorScreenParams<TabParamList>
      >)
    | undefined;
  License: undefined;
  LicenseRenewal: undefined;
  // Accord parental d'un compte de mineur (#61).
  ParentalConsent: undefined;
  Library: undefined;
  Settings: undefined;
  Competitions: undefined; // Tab
  CompetitionDetail: { competitionId: ID };
  LiveResults: { competitionId: ID };
  PerformanceSetup: undefined;
  PerformancePlayer: undefined;
  AudioPlayer: undefined;
  EventRegistrants: { eventId: ID; category: string; level: string };
  ManageRegistrations: { eventId: string };
  Notifications: undefined;
  ClubDashboard: undefined;
  ClubCompetitions: undefined;
  ClubCompetitionEditor:
    | { competition?: Competition; competitionId?: string }
    | undefined;
  ClubMembers: undefined;
  ClubMemberEditor: { member?: ClubMember; userId?: ID } | undefined;
  ClubCouples: undefined;
  ClubSoloTeams: undefined;
  ClubSoloTeamDetail: { teamId: string };
  ClubRegistrations: undefined;
  ClubRefundsDue: undefined;
  // Import des résultats publiés par le club organisateur (#690).
  ClubResultsImport: { competitionId: ID; competitionTitle?: string };
  Scanner: { competitionId?: ID } | undefined;
  VolunteerCheckin: { competitionId: ID; token: string };
  SeatPicker: { competitionId: ID };
  Profile: undefined;
  ForgotPassword: undefined;
  ResetPassword: { token?: string } | undefined;
  ViewCareer: { userId: string; userName?: string };
  // Param optionnel : deep link nu → CGU par défaut (voir LegalScreen)
  Legal: { doc: "cgu" | "privacy" | "mentions" } | undefined;
  // Propositions de correction des musiques : file admin (centrée sur une
  // proposition depuis une notification) et suivi par leur auteur.
  TrackCorrectionsReview: { correctionId?: string } | undefined;
  MyTrackCorrections: undefined;
};
export type TabParamList = {
  ScannerTab: undefined;
  ClubDashboard: { role?: string };
  Career: undefined;
  License: undefined;
  Library: undefined;
  Competitions: undefined;
  Settings: undefined;
};
