import { act, renderHook } from "@testing-library/react-native";
import React from "react";
import { ClubService } from "../../services/ClubService";
import {
  ClubProvider,
  ClubRepository,
  defaultClubRepository,
  useClubRepository,
} from "../ClubContext";
import { useClubStore } from "../../../../stores/club.store";

jest.mock("../../services/ClubService", () => ({
  ClubService: {
    getMembers: jest.fn(),
    checkEligibility: jest.fn(),
  },
}));

describe("ClubContext", () => {
  const mockRepo: ClubRepository = {
    getMembers: jest.fn(),
    checkEligibility: jest.fn(),
  };

  afterEach(() => {
    // Reset Zustand store to default after each test
    useClubStore.setState({ repository: defaultClubRepository });
  });

  it("provides the repository through context", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ClubProvider implementation={mockRepo}>{children}</ClubProvider>
    );

    const { result } = await renderHook(() => useClubRepository(), { wrapper });

    await act(async () => {});

    expect(result.current).toBe(mockRepo);
  });

  it("returns a repository when used without a provider (Zustand store default)", async () => {
    const { result } = await renderHook(() => useClubRepository());
    expect(result.current).toBeDefined();
    expect(typeof result.current.getMembers).toBe("function");
  });

  describe("defaultClubRepository", () => {
    it("calls ClubService.getMembers", async () => {
      const mockMembers = [{ id: "1", firstName: "John", lastName: "Doe" }];
      (ClubService.getMembers as jest.Mock).mockResolvedValue(mockMembers);

      const result = await defaultClubRepository.getMembers();

      expect(result).toBe(mockMembers);

      expect(ClubService.getMembers).toHaveBeenCalled();
    });

    it("calls ClubService.checkEligibility", () => {
      (ClubService.checkEligibility as jest.Mock).mockReturnValue(true);
      const mockMember = { id: "1" } as never;
      const mockEvent = { ageGroup: "A", category: "B" };

      const result = defaultClubRepository.checkEligibility(
        mockMember,
        mockEvent,
      );

      expect(result).toBe(true);

      expect(ClubService.checkEligibility).toHaveBeenCalledWith(
        mockMember,
        mockEvent,
      );
    });
  });
});
