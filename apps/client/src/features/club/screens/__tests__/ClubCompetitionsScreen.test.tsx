import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import type { MockFluidSegmentedTabProps } from "../../../../__tests__/mocks/types";
import { competitionsControllerGetClubCompetitions } from "../../../../api/generated/sdk.gen";
import { useTheme } from "../../../../context/ThemeContext";
import { createMockScreenProps } from "../../../../utils/testUtils";
import {
  ClubCompetitionsScreen,
  displayStatus,
} from "../ClubCompetitionsScreen";

jest.mock("../../../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useTheme: jest.fn(),
}));

// Like the real useFocusEffect: runs on mount (first focus); `refocus`
// simulates coming back from the editor.
let mockFocusCallback: (() => void) | null = null;
const refocus = () => mockFocusCallback?.();
jest.mock("@react-navigation/native", () => {
  const ReactActual = jest.requireActual<typeof React>("react");
  return {
    useFocusEffect: (callback: () => void) => {
      mockFocusCallback = callback;
      ReactActual.useEffect(() => callback(), [callback]);
    },
  };
});

// Configure-client side-effect is irrelevant in tests.
jest.mock("../../../../api/client", () => ({}));
jest.mock("../../../../api/generated/sdk.gen", () => ({
  competitionsControllerGetClubCompetitions: jest.fn(),
}));

jest.mock("../../../../components/FluidSegmentedTab", () => {
  const { TouchableOpacity, Text } = require("react-native");
  return {
    FluidSegmentedTab: ({ options, onChange }: MockFluidSegmentedTabProps) => (
      <>
        {options.map((opt) => (
          <TouchableOpacity
            accessibilityRole="button"
            key={opt.value}
            onPress={() => onChange(opt.value)}
          >
            <Text>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </>
    ),
  };
});

const listMock = competitionsControllerGetClubCompetitions as jest.Mock;

const UPCOMING = {
  id: "c0ffee00-0000-4000-8000-000000000001",
  title: "Gala du club",
  date: "2099-03-12T00:00:00.000Z",
  location: "Salle des fêtes, Lyon",
  status: "UPCOMING",
  organizer: "Club Test",
  layout: [{ id: "t1", type: "TABLE" }],
};
const PAST = {
  id: "c0ffee00-0000-4000-8000-000000000002",
  title: "Open d'hiver",
  date: "2020-01-10T00:00:00.000Z",
  location: "Gymnase, Paris",
  status: "UPCOMING",
  organizer: "Club Test",
};

describe("ClubCompetitionsScreen", () => {
  const mockTheme = {
    background: "#fff",
    surface: "#f2f2f2",
    text: "#111",
    textSecondary: "#666",
    primary: "#3b82f6",
    border: "#e5e7eb",
  };
  let client: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFocusCallback = null;
    (useTheme as jest.Mock).mockReturnValue({ theme: mockTheme });
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
  });

  const renderScreen = async () => {
    const props = createMockScreenProps("ClubCompetitions", undefined);
    const utils = await render(
      <QueryClientProvider client={client}>
        <ClubCompetitionsScreen {...props} />
      </QueryClientProvider>,
    );
    return { props, ...utils };
  };

  it("renders the club's competitions from the API", async () => {
    listMock.mockResolvedValue({ data: [UPCOMING, PAST] });

    const { findByText, getAllByText, getByText, queryByText } =
      await renderScreen();

    expect(await findByText("Gala du club")).toBeTruthy();
    expect(getByText("Open d'hiver")).toBeTruthy();
    expect(getByText("Salle des fêtes, Lyon")).toBeTruthy();
    // Badge of the upcoming card + the "À venir" filter tab.
    expect(getAllByText("À venir")).toHaveLength(2);
    expect(getByText("Terminée")).toBeTruthy();
    // The former hard-coded mock is gone.
    expect(queryByText("Grand Prix de Paris")).toBeNull();
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("opens the editor on the real competition", async () => {
    listMock.mockResolvedValue({ data: [UPCOMING] });

    const { findByText, props } = await renderScreen();

    await fireEvent.press(await findByText("Gala du club"));
    expect(props.navigation.navigate).toHaveBeenCalledWith(
      "ClubCompetitionEditor",
      {
        competition: expect.objectContaining({
          id: UPCOMING.id,
          date: UPCOMING.date,
          layout: UPCOMING.layout,
        }),
      },
    );
  });

  it("shows an empty state when the club organizes nothing", async () => {
    listMock.mockResolvedValue({ data: [] });

    const { findByTestId, getByText } = await renderScreen();

    expect(await findByTestId("club-competitions-empty")).toBeTruthy();
    expect(
      getByText(/Votre club n'organise encore aucune compétition/),
    ).toBeTruthy();
  });

  it("shows an error state and retries", async () => {
    listMock.mockResolvedValueOnce({ error: { statusCode: 500 } });

    const { findByTestId, getByTestId, findByText } = await renderScreen();

    expect(await findByTestId("club-competitions-error")).toBeTruthy();

    listMock.mockResolvedValueOnce({ data: [UPCOMING] });
    await fireEvent.press(getByTestId("club-competitions-retry"));
    expect(await findByText("Gala du club")).toBeTruthy();
  });

  it("filters upcoming and past competitions", async () => {
    listMock.mockResolvedValue({ data: [UPCOMING, PAST] });

    const { findByText, getByText, queryByText } = await renderScreen();
    await findByText("Gala du club");

    await fireEvent.press(getByText("Passées"));
    expect(queryByText("Gala du club")).toBeNull();
    expect(getByText("Open d'hiver")).toBeTruthy();

    await fireEvent.press(getByText("À venir"));
    expect(getByText("Gala du club")).toBeTruthy();
    expect(queryByText("Open d'hiver")).toBeNull();
  });

  it("reloads the list when the screen regains focus (after create/edit)", async () => {
    listMock.mockResolvedValueOnce({ data: [] });

    const { findByTestId, findByText } = await renderScreen();
    await findByTestId("club-competitions-empty");
    expect(listMock).toHaveBeenCalledTimes(1);

    listMock.mockResolvedValueOnce({ data: [UPCOMING] });
    refocus();

    expect(await findByText("Gala du club")).toBeTruthy();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });
});

describe("displayStatus", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  it("keeps a cancelled competition cancelled", () => {
    expect(
      displayStatus({ status: "CANCELLED", date: "2099-01-01" }, now),
    ).toBe("CANCELLED");
  });

  it("keeps LIVE and derives past/upcoming from the date", () => {
    expect(displayStatus({ status: "LIVE", date: "2026-05-30" }, now)).toBe(
      "LIVE",
    );
    expect(displayStatus({ status: "UPCOMING", date: "2026-01-01" }, now)).toBe(
      "PAST",
    );
    expect(displayStatus({ status: "PAST", date: "2026-07-01" }, now)).toBe(
      "UPCOMING",
    );
  });
});
