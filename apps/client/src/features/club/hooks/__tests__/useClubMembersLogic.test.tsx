import { act, renderHook, waitFor } from "@testing-library/react-native";
import { ClubService } from "../../services/ClubService";

jest.mock("../../services/ClubService", () => ({
  ClubService: { getMembers: jest.fn() },
}));
jest.mock("@react-navigation/native", () => ({
  __esModule: true,
  useFocusEffect: jest.fn(),
}));

const { useClubMembersLogic } = require("../useClubMembersLogic");

describe("useClubMembersLogic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads members", async () => {
    (ClubService.getMembers as jest.Mock).mockResolvedValue([
      {
        id: "m1",
        firstName: "Jean",
        lastName: "Dupont",
        category: "Adulte",
      },
      {
        id: "m2",
        firstName: "Marie",
        lastName: "Curie",
        category: "Adulte",
      },
    ]);

    const { result } = await renderHook(() => useClubMembersLogic());

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.members).toHaveLength(2);
  });

  it("filters members by search query", async () => {
    (ClubService.getMembers as jest.Mock).mockResolvedValue([
      {
        id: "m1",
        firstName: "Jean",
        lastName: "Dupont",
        license: { number: "LIC-123" },
      },
      {
        id: "m2",
        firstName: "Marie",
        lastName: "Curie",
        license: { number: "LIC-999" },
      },
    ]);

    const { result } = await renderHook(() => useClubMembersLogic());

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(() => {
      result.current.setSearchQuery("LIC-123");
    });

    expect(result.current.members).toHaveLength(1);
    expect(result.current.members[0].id).toBe("m1");
  });
});
