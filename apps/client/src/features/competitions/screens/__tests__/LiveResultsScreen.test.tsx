import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react-native";
import React from "react";
import { theme as tokens } from "../../../../theme";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { useLiveResultsLogic } from "../../hooks/useLiveResultsLogic";
import { LiveResultsScreen } from "../LiveResultsScreen";

jest.mock("../../hooks/useLiveResultsLogic");
jest.mock("../../../../utils/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }),
}));

// Mock SectionList + RefreshControl to avoid cleanup timeout (virtualization internals)
jest.mock("react-native", () => {
  const RN = jest.requireActual<typeof import("react-native")>("react-native");
  const MockReact = require("react");
  const SectionListMock = ({
    sections,
    renderItem,
    renderSectionHeader,
    ListEmptyComponent,
    refreshControl,
  }: {
    sections: Array<{ title: string; data: unknown[] }>;
    renderItem: (props: { item: unknown }) => React.ReactNode;
    renderSectionHeader: (props: { section: unknown }) => React.ReactNode;
    ListEmptyComponent?: React.ComponentType | React.ReactElement;
    refreshControl?: React.ReactElement;
  }) => (
    <RN.View testID="section-list-mock">
      {refreshControl}
      {sections.length === 0 && ListEmptyComponent
        ? MockReact.isValidElement(ListEmptyComponent)
          ? ListEmptyComponent
          : MockReact.createElement(ListEmptyComponent as React.ComponentType)
        : sections.map((s: { title: string; data: unknown[] }) => (
            <RN.View key={s.title}>
              {renderSectionHeader({ section: s })}
              {s.data.map((item: unknown, i: number) => {
                const itemId = (item as { id?: string }).id ?? String(i);
                return <RN.View key={itemId}>{renderItem({ item })}</RN.View>;
              })}
            </RN.View>
          ))}
    </RN.View>
  );
  return {
    ...RN,
    SectionList: SectionListMock,
    RefreshControl: ({
      onRefresh,
      refreshing,
    }: {
      onRefresh: () => void;
      refreshing: boolean;
    }) => (
      <RN.TouchableOpacity
        testID="refresh-control"
        onPress={onRefresh}
        disabled={refreshing}
      />
    ),
  };
});

// Mock minimal dependencies to avoid hangs
jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      background: "#ffffff",
      text: "#111111",
      textSecondary: "#666666",
      primary: "#004481",
      surface: "#f7f7f7",
      border: "#e0e0e0",
      danger: "#d32f2f",
      success: "#2e7d32",
    },
    isDark: false,
  }),
}));

const mockUseLiveResultsLogic = useLiveResultsLogic as jest.MockedFunction<
  typeof useLiveResultsLogic
>;

describe("LiveResultsScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await cleanup();
  });

  const createTestProps = () =>
    createMockScreenProps("LiveResults", { competitionId: "c1" });

  it("renders correctly with minimal mocks", async () => {
    mockUseLiveResultsLogic.mockReturnValue({
      state: { sections: [], refreshing: false, eventLabel: "" },
      actions: { loadResults: jest.fn() },
    });

    const { getByText } = await render(
      <LiveResultsScreen {...createTestProps()} />,
    );

    expect(getByText("Résultats en direct")).toBeTruthy();
  });

  it("renders results grouped by round", async () => {
    const mockLoadResults = jest.fn();
    mockUseLiveResultsLogic.mockReturnValue({
      state: {
        sections: [
          {
            title: "Finale",
            data: [
              {
                id: "r1",
                eventId: "e1",
                round: "Finale",
                ranking: 1,
                details: { participant: "Martin", status: "QUALIFIED" },
                event: {
                  id: "e1",
                  competitionId: "c1",
                  category: "Latin",
                  level: "A",
                  ageGroup: "Adult",
                },
              },
            ],
          },
        ],
        refreshing: false,
        eventLabel: "LATIN - A",
      },
      actions: { loadResults: mockLoadResults },
    });

    const { getByText } = await render(
      <LiveResultsScreen {...createTestProps()} />,
    );

    expect(getByText("Finale")).toBeTruthy();
    expect(getByText("Martin")).toBeTruthy();
    expect(getByText("QUALIFIÉ")).toBeTruthy();
  });

  it("calls goBack when back button is pressed", async () => {
    const props = createTestProps();
    mockUseLiveResultsLogic.mockReturnValue({
      state: { sections: [], refreshing: false, eventLabel: "" },
      actions: { loadResults: jest.fn() },
    });

    const { getByTestId } = await render(<LiveResultsScreen {...props} />);

    await fireEvent.press(getByTestId("back-button"));
    expect(props.navigation.goBack).toHaveBeenCalled();
  });

  it("passes competitionId to useLiveResultsLogic", async () => {
    const mockLoadResults = jest.fn();
    mockUseLiveResultsLogic.mockReturnValue({
      state: { sections: [], refreshing: false, eventLabel: "" },
      actions: { loadResults: mockLoadResults },
    });

    await render(<LiveResultsScreen {...createTestProps()} />);

    expect(mockUseLiveResultsLogic).toHaveBeenCalledWith({
      competitionId: "c1",
    });
  });

  it("renders podium rankings with trophies", async () => {
    mockUseLiveResultsLogic.mockReturnValue({
      state: {
        sections: [
          {
            title: "Round 1",
            data: [
              {
                id: "1",
                eventId: "e1",
                round: "R1",
                ranking: 1,
                details: { participant: "Winner" },
              },
              {
                id: "2",
                eventId: "e1",
                round: "R1",
                ranking: 2,
                details: { participant: "Second" },
              },
              {
                id: "3",
                eventId: "e1",
                round: "R1",
                ranking: 3,
                details: { participant: "Third" },
              },
            ],
          },
        ],
        refreshing: false,
        eventLabel: "",
      },
      actions: { loadResults: jest.fn() },
    });

    const { getByText } = await render(
      <LiveResultsScreen {...createTestProps()} />,
    );

    expect(getByText("Winner")).toBeTruthy();
    expect(getByText("Second")).toBeTruthy();
    expect(getByText("Third")).toBeTruthy();
  });

  // Verrouille le mapping couleur médaille (source unique : utils/podium.ts) :
  // rang 1/2/3 → or/argent/bronze via les tokens du thème. Sans statut, le
  // numéro de rang podium est rendu à droite avec la couleur médaille.
  it("locks the medal colour mapping (1/2/3 -> gold/silver/bronze tokens)", async () => {
    mockUseLiveResultsLogic.mockReturnValue({
      state: {
        sections: [
          {
            title: "Finale",
            data: [
              {
                id: "1",
                eventId: "e1",
                round: "R1",
                ranking: 1,
                details: { participant: "First" },
              },
              {
                id: "2",
                eventId: "e1",
                round: "R1",
                ranking: 2,
                details: { participant: "Second" },
              },
              {
                id: "3",
                eventId: "e1",
                round: "R1",
                ranking: 3,
                details: { participant: "Third" },
              },
            ],
          },
        ],
        refreshing: false,
        eventLabel: "",
      },
      actions: { loadResults: jest.fn() },
    });

    const { getByText } = await render(
      <LiveResultsScreen {...createTestProps()} />,
    );

    expect(getByText("1")).toHaveStyle({ color: tokens.colors.gold });
    expect(getByText("2")).toHaveStyle({ color: tokens.colors.silver });
    expect(getByText("3")).toHaveStyle({ color: tokens.colors.bronze });
  });

  it("renders qualified and eliminated statuses properly", async () => {
    mockUseLiveResultsLogic.mockReturnValue({
      state: {
        sections: [
          {
            title: "Round 1",
            data: [
              {
                id: "q",
                eventId: "e1",
                round: "R1",
                ranking: 5,
                details: { participant: "Qualified", status: "QUALIFIED" },
              },
              {
                id: "e",
                eventId: "e1",
                round: "R1",
                ranking: 10,
                details: {
                  participant: "Eliminated",
                  status: "ELIMINATED",
                  marks: 2,
                },
              },
            ],
          },
        ],
        refreshing: false,
        eventLabel: "",
      },
      actions: { loadResults: jest.fn() },
    });

    const { getByText } = await render(
      <LiveResultsScreen {...createTestProps()} />,
    );

    expect(getByText("QUALIFIÉ")).toBeTruthy();
    expect(getByText("ÉLIMINÉ")).toBeTruthy();
    expect(getByText("2 croix")).toBeTruthy();
    expect(getByText("Q")).toBeTruthy();
    expect(getByText("X")).toBeTruthy();
  });

  it("renders empty state when no sections", async () => {
    mockUseLiveResultsLogic.mockReturnValue({
      state: { sections: [], refreshing: false, eventLabel: "" },
      actions: { loadResults: jest.fn() },
    });

    await render(<LiveResultsScreen {...createTestProps()} />);

    expect(screen.getByText("En attente de résultats")).toBeTruthy();
    expect(
      screen.getByText(/Les résultats des épreuves en cours/),
    ).toBeTruthy();
  });

  it("triggers onRefresh when pulled", async () => {
    const mockLoadResults = jest.fn().mockResolvedValue(undefined);
    mockUseLiveResultsLogic.mockReturnValue({
      state: {
        sections: [
          {
            title: "S1",
            data: [
              {
                id: "1",
                eventId: "e1",
                round: "R1",
                ranking: 1,
                details: { participant: "P1" },
              },
            ],
          },
        ],
        refreshing: false,
        eventLabel: "",
      },
      actions: { loadResults: mockLoadResults },
    });

    const { getByTestId } = await render(
      <LiveResultsScreen {...createTestProps()} />,
    );

    await fireEvent.press(getByTestId("refresh-control"));
    expect(mockLoadResults).toHaveBeenCalled();
  });
});
