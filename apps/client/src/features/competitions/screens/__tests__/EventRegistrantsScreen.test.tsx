import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react-native";
import React from "react";
import { useTheme } from "../../../../context/ThemeContext";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { useCompetitionRepository } from "../../context/CompetitionContext";
import { EventRegistrantsScreen } from "../EventRegistrantsScreen";

jest.mock("../../context/CompetitionContext");
jest.mock("../../../../context/ThemeContext");

const mockUseCompetitionRepository =
  useCompetitionRepository as jest.MockedFunction<
    typeof useCompetitionRepository
  >;
const mockUseTheme = useTheme as jest.MockedFunction<typeof useTheme>;

const mockTheme = {
  background: "#ffffff",
  text: "#111111",
  textSecondary: "#666666",
  primary: "#004481",
  surface: "#f7f7f7",
  border: "#e0e0e0",
};

describe("EventRegistrantsScreen", () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const renderWithClient = async (ui: React.ReactElement) => {
    return await render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient.clear();
    mockUseTheme.mockReturnValue({ theme: mockTheme } as unknown as ReturnType<
      typeof useTheme
    >);
  });

  const createTestProps = () =>
    createMockScreenProps("EventRegistrants", {
      eventId: "e1",
      category: "Latin",
      level: "A",
    });

  it("renders empty state when no registrants", async () => {
    mockUseCompetitionRepository.mockReturnValue({
      getEventRegistrations: jest.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof useCompetitionRepository>);

    const { getByText } = await renderWithClient(
      <EventRegistrantsScreen {...createTestProps()} />,
    );

    await waitFor(() => {
      expect(getByText("Aucun inscrit")).toBeTruthy();
    });
  });

  it("renders registrant data", async () => {
    mockUseCompetitionRepository.mockReturnValue({
      getEventRegistrations: jest.fn().mockResolvedValue([
        {
          user: {
            id: "u1",
            firstName: "Anna",
            lastName: "Durand",
            clubName: "Club Paris",
            nationalRanking: 3,
          },
        },
      ]),
    } as unknown as ReturnType<typeof useCompetitionRepository>);

    const { getByText } = await renderWithClient(
      <EventRegistrantsScreen {...createTestProps()} />,
    );

    await waitFor(() => {
      expect(getByText("Anna Durand")).toBeTruthy();
      expect(getByText("Club Paris")).toBeTruthy();
      expect(getByText("3")).toBeTruthy();
    });
  });
});
