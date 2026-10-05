/**
 * Types de mock pour les tests des hooks
 *
 * Ces types permettent d'éviter l'utilisation de `as any` dans les tests
 * et d'améliorer la sécurité de type.
 */

import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { AuthRepository } from "../../features/auth/context/AuthContext";
import { ClubRepository } from "../../features/club/context/ClubContext";
import { CompetitionRepository } from "../../features/competitions/context/CompetitionContext";
import { RootStackParamList } from "../../navigation/types";

/**
 * Mock partiel de AuthRepository pour les tests
 */
export type MockAuthRepository = Partial<{
  login: jest.Mock;
  logout: jest.Mock;
  getAuthConfig: jest.Mock;
  updateAuthConfig: jest.Mock;
  register: jest.Mock;
}>;

/**
 * Mock partiel de CompetitionRepository pour les tests
 */
export type MockCompetitionRepository = Partial<{
  getCompetitionDetails: jest.Mock;
  registerForEvent: jest.Mock;
  unregisterFromEvent: jest.Mock;
  getUserRegistrations: jest.Mock;
  getCompetitions: jest.Mock;
  loadCompetitions: jest.Mock;
}>;

/**
 * Mock partiel de ClubRepository pour les tests
 */
export type MockClubRepository = Partial<{
  getMembers: jest.Mock;
  getCompetitions: jest.Mock;
  createCompetition: jest.Mock;
  updateCompetition: jest.Mock;
  deleteCompetition: jest.Mock;
}>;

/**
 * Mock de navigation pour les tests
 */
export type MockNavigation = Partial<
  NativeStackNavigationProp<RootStackParamList>
> & {
  navigate: jest.Mock;
  goBack: jest.Mock;
  replace: jest.Mock;
  push: jest.Mock;
  pop: jest.Mock;
};

/**
 * Crée un mock AuthRepository typé
 */
export function createMockAuthRepository(): MockAuthRepository &
  AuthRepository {
  return {
    login: jest.fn(),
    logout: jest.fn(),
    getAuthConfig: jest.fn(),
    updateAuthConfig: jest.fn(),
    register: jest.fn(),
  } as MockAuthRepository & AuthRepository;
}

/**
 * Crée un mock CompetitionRepository typé
 */
export function createMockCompetitionRepository(): MockCompetitionRepository &
  CompetitionRepository {
  return {
    getCompetitionDetails: jest.fn(),
    registerForEvent: jest.fn(),
    unregisterFromEvent: jest.fn(),
    getUserRegistrations: jest.fn(),
    getCompetitions: jest.fn(),
    loadCompetitions: jest.fn(),
  } as MockCompetitionRepository & CompetitionRepository;
}

/**
 * Crée un mock ClubRepository typé
 */
export function createMockClubRepository(): MockClubRepository &
  ClubRepository {
  return {
    getMembers: jest.fn(),
    getCompetitions: jest.fn(),
    createCompetition: jest.fn(),
    updateCompetition: jest.fn(),
    deleteCompetition: jest.fn(),
  } as MockClubRepository & ClubRepository;
}

/**
 * Crée un mock Navigation typé
 */
export function createMockNavigation(): MockNavigation {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    replace: jest.fn(),
    push: jest.fn(),
    pop: jest.fn(),
  } as MockNavigation;
}

import { Event } from "../../features/competitions/context/CompetitionContext";

/**
 * Type partiel pour Event utilisé dans les tests
 * Permet de créer des objets Event partiels sans utiliser `as any`
 * Utilise Pick pour garantir que les propriétés requises sont présentes
 */
export type PartialEvent = Pick<Event, "id"> & Partial<Omit<Event, "id">>;

/**
 * Helper pour créer un Event partiel typé pour les tests
 * Les propriétés manquantes seront undefined, ce qui est acceptable pour les tests
 */
export function createPartialEvent(
  overrides: PartialEvent = { id: "evt-1" },
): Event {
  return {
    competitionId: "comp-1",
    category: "A",
    ageGroup: "Adulte",
    ...overrides,
  } as Event;
}
