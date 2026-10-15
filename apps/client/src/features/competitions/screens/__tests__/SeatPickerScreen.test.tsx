import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import { Alert } from "react-native";
import { useTheme } from "../../../../context/ThemeContext";
import {
  SeatBookingApi,
  SeatBookingError,
} from "../../../../services/api/seat-booking-api";
import * as announceModule from "../../../../utils/announce";
import { openExternalUrl } from "../../../../utils/externalUrl";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { useCompetitionRepository } from "../../context/CompetitionContext";
import { SeatPickerScreen } from "../SeatPickerScreen";

jest.mock("../../../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useTheme: jest.fn(),
}));
jest.mock("@react-navigation/native", () => {
  const ReactActual = jest.requireActual<typeof React>("react");
  return {
    useFocusEffect: (callback: () => void) => {
      ReactActual.useEffect(() => callback(), [callback]);
    },
  };
});
jest.mock("../../../../api/client", () => ({}));
jest.mock("../../../../services/api/seat-booking-api", () => ({
  ...jest.requireActual("../../../../services/api/seat-booking-api"),
  SeatBookingApi: { getOccupancy: jest.fn(), checkout: jest.fn() },
}));
jest.mock("../../../../utils/externalUrl", () => ({
  openExternalUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock("../../context/CompetitionContext");

const getOccupancy = SeatBookingApi.getOccupancy as jest.Mock;
const checkout = SeatBookingApi.checkout as jest.Mock;
const getCompetitionDetails = jest.fn();
(useCompetitionRepository as jest.Mock).mockReturnValue({
  getCompetitionDetails,
});

const theme = {
  background: "#ffffff",
  surface: "#f7f7f7",
  text: "#111111",
  textSecondary: "#666666",
  primary: "#004481",
  border: "#e0e0e0",
  success: "#2e7d32",
  warning: "#ed6c02",
  danger: "#d32f2f",
};

const LAYOUT = [
  {
    id: "t1",
    type: "TABLE",
    label: "Table 1",
    capacity: 4,
    lockedSeats: [3],
    priceCents: 1500,
  },
  { id: "o1", type: "OTHER", label: "Bar", capacity: 10, priceCents: 500 },
  // No price: not for sale, not shown.
  { id: "t2", type: "TABLE", label: "Table officiels", capacity: 4 },
];

const OCCUPANCY = {
  competitionId: "c1",
  elements: [
    {
      itemId: "t1",
      mode: "numbered",
      available: 1,
      taken: 1,
      held: 1,
      mine: 0,
      takenSeats: [0],
      heldSeats: [1],
      mySeats: [],
      wholeElementBooked: false,
    },
    {
      itemId: "o1",
      mode: "free",
      available: 0,
      taken: 10,
      held: 0,
      mine: 0,
      takenSeats: [],
      heldSeats: [],
      mySeats: [],
      wholeElementBooked: false,
    },
    {
      itemId: "t2",
      mode: "numbered",
      available: 4,
      taken: 0,
      held: 0,
      mine: 0,
      takenSeats: [],
      heldSeats: [],
      mySeats: [],
      wholeElementBooked: false,
    },
  ],
};

let queryClient: QueryClient;

async function renderScreen() {
  const props = createMockScreenProps("SeatPicker", { competitionId: "c1" });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <SeatPickerScreen {...props} />
    </QueryClientProvider>,
  );
  return { ...screen, props };
}

beforeEach(() => {
  jest.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  (useTheme as jest.Mock).mockReturnValue({ theme, isDark: false });
  getCompetitionDetails.mockResolvedValue({
    id: "c1",
    title: "Open de Lyon",
    layout: LAYOUT,
  });
  getOccupancy.mockResolvedValue(OCCUPANCY);
  checkout.mockResolvedValue({
    id: 7,
    redirectUrl: "https://www.helloasso.com/pay/7",
    bookingId: "b7",
    seatIndex: 2,
    expiresAt: "2026-10-15T12:50:00.000Z",
    resumed: false,
  });
});

describe("SeatPickerScreen", () => {
  it("shows each seat with its state, in French, for screen readers", async () => {
    const { findByLabelText, getByLabelText, getByText, queryByText } =
      await renderScreen();

    expect(await findByLabelText("Table 1, Place 3, libre")).toBeTruthy();
    expect(getByLabelText("Table 1, Place 1, déjà réservée")).toBeTruthy();
    expect(
      getByLabelText("Table 1, Place 2, en cours de réservation"),
    ).toBeTruthy();
    expect(getByLabelText("Table 1, Place 4, indisponible")).toBeTruthy();
    expect(getByText("Open de Lyon")).toBeTruthy();
    expect(getByText("15,00 €")).toBeTruthy();
    expect(queryByText("Table officiels")).toBeNull();
  });

  it("disables unavailable seats and a full free placement", async () => {
    const { findByTestId, getByTestId, queryByTestId } = await renderScreen();

    const taken = await findByTestId("seat-t1-0");
    expect(taken.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(taken);
    await fireEvent.press(getByTestId("seat-t1-3"));
    expect(getByTestId("seat-free-o1").props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(queryByTestId("seat-picker-footer")).toBeNull();
  });

  it("picks a seat, pays it with its index and opens HelloAsso", async () => {
    const { findByTestId, getByTestId, getByText } = await renderScreen();

    await fireEvent.press(await findByTestId("seat-t1-2"));
    expect(getByTestId("seat-t1-2").props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(getByText("Table 1, Place 3")).toBeTruthy();

    await fireEvent.press(getByText("Payer 15,00 €"));

    await waitFor(() =>
      expect(checkout).toHaveBeenCalledWith({
        competitionId: "c1",
        itemId: "t1",
        seatIndex: 2,
        seatLabel: "Table 1, Place 3",
      }),
    );
    await waitFor(() =>
      expect(openExternalUrl).toHaveBeenCalledWith(
        "https://www.helloasso.com/pay/7",
      ),
    );
    expect(await findByTestId("seat-picker-hold")).toBeTruthy();
  });

  it("offers to resume the payment of the user's own held seat", async () => {
    getOccupancy.mockResolvedValue({
      ...OCCUPANCY,
      elements: [
        { ...OCCUPANCY.elements[0], mySeats: [1], mine: 1 },
        ...OCCUPANCY.elements.slice(1),
      ],
    });
    const { findByText, getByLabelText } = await renderScreen();

    expect(await findByText("Reprendre le paiement (15,00 €)")).toBeTruthy();
    expect(
      getByLabelText("Table 1, Place 2, votre place, paiement en attente").props
        .accessibilityState,
    ).toMatchObject({ selected: true });
  });

  it("after a refused seat, reloads the plan so the user can pick again", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    checkout.mockRejectedValue(
      new SeatBookingError(
        "conflict",
        "Cette place est déjà réservée. Choisissez une autre place.",
        409,
      ),
    );
    const { findByTestId, getByText, queryByTestId } = await renderScreen();

    await fireEvent.press(await findByTestId("seat-t1-2"));
    getOccupancy.mockResolvedValue({
      ...OCCUPANCY,
      elements: [
        { ...OCCUPANCY.elements[0], takenSeats: [0, 2], available: 0 },
        ...OCCUPANCY.elements.slice(1),
      ],
    });
    await fireEvent.press(getByText("Payer 15,00 €"));

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Place indisponible",
        "Cette place est déjà réservée. Choisissez une autre place.",
      ),
    );
    await waitFor(() =>
      expect(
        // The refreshed plan shows the seat as taken.
        queryByTestId("seat-t1-2")?.props.accessibilityLabel,
      ).toBe("Table 1, Place 3, déjà réservée"),
    );
    expect(queryByTestId("seat-picker-footer")).toBeNull();
    expect(openExternalUrl).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it("draws a gradin by rows and books a free placement without a seat", async () => {
    getCompetitionDetails.mockResolvedValue({
      id: "c1",
      title: "Open de Lyon",
      layout: [
        {
          id: "g1",
          type: "GRADIN",
          label: "Gradin",
          capacity: 6,
          rows: 2,
          cols: 3,
          priceCents: 900,
        },
        {
          id: "o1",
          type: "OTHER",
          label: "Bar",
          capacity: 10,
          priceCents: 500,
        },
      ],
    });
    getOccupancy.mockResolvedValue({
      competitionId: "c1",
      elements: [
        { ...OCCUPANCY.elements[2], itemId: "g1", available: 6 },
        { ...OCCUPANCY.elements[1], available: 3 },
      ],
    });
    const { findByLabelText, getByTestId, getByText } = await renderScreen();

    // Seat index = row × cols + col: row B, 3rd seat → 5.
    expect(
      (await findByLabelText("Gradin, Rang B, place 3, libre")).props.testID,
    ).toBe("seat-g1-5");

    await fireEvent.press(getByTestId("seat-free-o1"));
    expect(getByText("Place sélectionnée")).toBeTruthy();
    await fireEvent.press(getByText("Payer 5,00 €"));

    await waitFor(() =>
      expect(checkout).toHaveBeenCalledWith({
        competitionId: "c1",
        itemId: "o1",
        seatIndex: undefined,
        seatLabel: undefined,
      }),
    );
  });

  it("says when nothing is for sale", async () => {
    getOccupancy.mockResolvedValue({ competitionId: "c1", elements: [] });
    const { findByTestId } = await renderScreen();
    expect(await findByTestId("seat-picker-empty")).toBeTruthy();
  });

  it("offers a retry when the plan cannot be loaded", async () => {
    getOccupancy.mockRejectedValueOnce(new Error("boom"));
    const { findByTestId, findByLabelText } = await renderScreen();

    await fireEvent.press(await findByTestId("seat-picker-retry"));
    expect(await findByLabelText("Table 1, Place 3, libre")).toBeTruthy();
  });

  describe("screen reader (#22)", () => {
    it("reads each element header as one heading with price and availability", async () => {
      const { findByRole, getByRole } = await renderScreen();

      const header = await findByRole("header", {
        name: "Table 1, 15,00 €, 1 place disponible",
      });
      expect(header.props.testID).toBe("seat-element-header-t1");
      expect(
        getByRole("header", { name: "Bar, 5,00 €, Complet, placement libre" }),
      ).toBeTruthy();
      expect(getByRole("header", { name: "Open de Lyon" })).toBeTruthy();
    });

    it("gives seats a 44pt touch target", async () => {
      const { findByTestId } = await renderScreen();
      const seat = await findByTestId("seat-t1-2");
      expect(seat.props.hitSlop).toBe(5);
    });

    it("announces the reservation once on iOS (VoiceOver has no live regions)", async () => {
      const spy = jest
        .spyOn(announceModule, "announce")
        .mockImplementation(() => {});
      const { findByTestId, getByRole } = await renderScreen();

      await fireEvent.press(await findByTestId("seat-t1-2"));
      await fireEvent.press(
        getByRole("button", {
          name: "Payer Table 1, Place 3, 15,00 €, sur HelloAsso",
        }),
      );

      await waitFor(() =>
        expect(spy).toHaveBeenCalledWith(
          expect.stringContaining("Table 1, Place 3 vous est réservée"),
        ),
      );
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });

  it("goes back", async () => {
    const { findByLabelText, props } = await renderScreen();
    await findByLabelText("Table 1, Place 3, libre");
    await fireEvent.press(await findByLabelText("Retour"));
    expect(props.navigation.goBack).toHaveBeenCalled();
  });
});
