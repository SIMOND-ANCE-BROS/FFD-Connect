import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import {
  TrackCorrectionApi,
  type MyTrackCorrectionDto,
} from "../../../../services/api/track-correction-api";
import {
  MyTrackCorrectionsScreen,
  proposedSummary,
} from "../MyTrackCorrectionsScreen";

jest.mock("../../../../services/api/track-correction-api", () => ({
  TrackCorrectionApi: { listMine: jest.fn() },
}));

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      background: "#fff",
      surface: "#f2f2f2",
      text: "#111",
      textSecondary: "#666",
      primary: "#3b82f6",
      border: "#e5e7eb",
      danger: "#ef4444",
      success: "#10B981",
      warning: "#F59E0B",
    },
    isDark: false,
  }),
}));

const listMine = TrackCorrectionApi.listMine as jest.Mock;

const mine = (
  overrides: Partial<MyTrackCorrectionDto> = {},
): MyTrackCorrectionDto => ({
  id: "c1",
  trackId: "t1",
  reason: "PASO_CLASH",
  status: "PENDING",
  proposed: {
    title: null,
    artist: null,
    style: null,
    bpm: null,
    clashTimecodes: [45, 90],
  },
  message: null,
  reviewComment: null,
  reviewedAt: null,
  createdAt: "2026-10-06T10:00:00Z",
  trackTitle: "España Cañí",
  trackArtist: "Orchestre",
  ...overrides,
});

const renderScreen = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const navigation = { goBack: jest.fn() };
  return render(
    <QueryClientProvider client={client}>
      <MyTrackCorrectionsScreen
        navigation={
          navigation as unknown as React.ComponentProps<
            typeof MyTrackCorrectionsScreen
          >["navigation"]
        }
        route={{
          key: "k",
          name: "MyTrackCorrections",
          params: undefined,
        }}
      />
    </QueryClientProvider>,
  );
};

describe("MyTrackCorrectionsScreen", () => {
  beforeEach(() => jest.clearAllMocks());

  it("affiche chaque proposition avec son statut et la réponse de l'admin", async () => {
    listMine.mockResolvedValue({
      data: [
        mine(),
        mine({
          id: "c2",
          reason: "MPM",
          status: "REJECTED",
          proposed: {
            title: null,
            artist: null,
            style: null,
            bpm: 70,
            clashTimecodes: null,
          },
          message: "trop lent",
          reviewComment: "Le tempo est conforme",
        }),
        mine({ id: "c3", status: "APPROVED" }),
      ],
      meta: { total: 3, skip: 0, take: 50, hasMore: false },
    });
    const { findByText, getByTestId, getByText, getAllByText } =
      await renderScreen();

    expect(await findByText("Le tempo est conforme")).toBeTruthy();
    expect(getByTestId("correction-status-PENDING")).toBeTruthy();
    expect(getByTestId("correction-status-REJECTED")).toBeTruthy();
    expect(getByTestId("correction-status-APPROVED")).toBeTruthy();
    expect(getAllByText("Clashs : 0:45, 1:30")).toHaveLength(2);
    expect(getByText("MPM : 70")).toBeTruthy();
    expect(getByText("Votre commentaire : trop lent")).toBeTruthy();
  });

  it("explique comment proposer quand la liste est vide", async () => {
    listMine.mockResolvedValue({
      data: [],
      meta: { total: 0, skip: 0, take: 50, hasMore: false },
    });
    const { findByTestId } = await renderScreen();
    expect(await findByTestId("my-corrections-empty")).toBeTruthy();
  });

  it("propose de réessayer en cas d'échec", async () => {
    listMine.mockRejectedValueOnce(new Error("down")).mockResolvedValue({
      data: [],
      meta: { total: 0, skip: 0, take: 50, hasMore: false },
    });
    const { findByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId("my-corrections-retry"));
    await waitFor(() => expect(listMine).toHaveBeenCalledTimes(2));
  });

  it("charge la page suivante en fin de liste", async () => {
    listMine.mockImplementation(({ skip }: { skip: number }) =>
      Promise.resolve({
        data: [mine({ id: `c-${skip}`, trackTitle: `Piste ${skip}` })],
        meta: { total: 21, skip, take: 20, hasMore: skip === 0 },
      }),
    );
    const { findByTestId, getByTestId } = await renderScreen();
    await findByTestId("my-correction-c-0");
    expect(listMine).toHaveBeenCalledWith({ skip: 0, take: 20 });

    await fireEvent(getByTestId("my-corrections-list"), "onEndReached");

    expect(await findByTestId("my-correction-c-20")).toBeTruthy();
    expect(listMine).toHaveBeenLastCalledWith({ skip: 20, take: 20 });
  });

  it("résume toutes les valeurs proposées", () => {
    expect(
      proposedSummary(
        mine({
          proposed: {
            title: "T",
            artist: "A",
            style: "Rumba",
            bpm: 25,
            clashTimecodes: [],
          },
        }),
      ),
    ).toEqual([
      "Titre : T",
      "Artiste : A",
      "Danse : Rumba",
      "MPM : 25",
      "Clashs : aucun",
    ]);
  });
});
