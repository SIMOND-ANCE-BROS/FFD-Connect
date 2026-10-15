import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import { Alert, type AlertButton } from "react-native";
import {
  SeatBookingApi,
  SeatBookingError,
  SEAT_BOOKING_MESSAGES,
} from "../../../../services/api/seat-booking-api";
import { openExternalUrl } from "../../../../utils/externalUrl";
import { useCompetitionRepository } from "../../context/CompetitionContext";
import { useSeatBooking } from "../useSeatBooking";

// Like the real useFocusEffect: runs on mount (first focus); `refocus`
// simulates coming back to the screen (e.g. from HelloAsso).
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
const openUrl = openExternalUrl as jest.Mock;
const getCompetitionDetails = jest.fn();
(useCompetitionRepository as jest.Mock).mockReturnValue({
  getCompetitionDetails,
});

const LAYOUT = [
  {
    id: "g1",
    type: "GRADIN",
    label: "Gradin",
    capacity: 6,
    rows: 2,
    cols: 3,
    lockedSeats: [5],
    priceCents: 1200,
  },
  { id: "o1", type: "OTHER", label: "Bar", capacity: 10, priceCents: 500 },
];

const numbered = (overrides = {}) => ({
  itemId: "g1",
  mode: "numbered" as const,
  available: 3,
  taken: 1,
  held: 1,
  mine: 0,
  takenSeats: [0],
  heldSeats: [1],
  mySeats: [] as number[],
  wholeElementBooked: false,
  ...overrides,
});
const free = {
  itemId: "o1",
  mode: "free" as const,
  available: 4,
  taken: 6,
  held: 0,
  mine: 0,
  takenSeats: [],
  heldSeats: [],
  mySeats: [],
  wholeElementBooked: false,
};

const CHECKOUT = {
  id: 1,
  redirectUrl: "https://www.helloasso.com/pay/1",
  bookingId: "b1",
  seatIndex: 4,
  expiresAt: "2026-10-15T12:50:00.000Z",
  resumed: false,
};

let queryClient: QueryClient;
const wrapper = ({ children }: PropsWithChildren) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

async function renderReady() {
  const rendered = await renderHook(() => useSeatBooking("c1"), { wrapper });
  await waitFor(() => expect(rendered.result.current.elements).toHaveLength(2));
  return rendered;
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  getCompetitionDetails.mockResolvedValue({
    id: "c1",
    title: "Open",
    layout: LAYOUT,
  });
  getOccupancy.mockResolvedValue({
    competitionId: "c1",
    elements: [numbered(), free],
  });
  checkout.mockResolvedValue(CHECKOUT);
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => alertSpy.mockRestore());

describe("useSeatBooking", () => {
  it("joins the plan with its occupancy", async () => {
    const { result } = await renderReady();
    expect(result.current.competitionTitle).toBe("Open");
    expect(result.current.elements.map((e) => [e.id, e.mode])).toEqual([
      ["g1", "numbered"],
      ["o1", "free"],
    ]);
    expect(result.current.selection).toBeNull();
  });

  it("ignores taps on taken, held and locked seats", async () => {
    const { result } = await renderReady();
    for (const index of [0, 1, 5]) {
      await act(() => result.current.selectSeat("g1", index));
    }
    expect(result.current.selection).toBeNull();
  });

  it("selects a free seat, toggles it off, and pays it with its index", async () => {
    const { result } = await renderReady();

    await act(() => result.current.selectSeat("g1", 4));
    expect(result.current.selection).toEqual({ itemId: "g1", seatIndex: 4 });
    expect(result.current.selectedLabel).toBe("Gradin, Rang B, place 2");

    await act(() => result.current.pay());
    expect(checkout).toHaveBeenCalledWith({
      competitionId: "c1",
      itemId: "g1",
      seatIndex: 4,
      seatLabel: "Gradin, Rang B, place 2",
    });
    await waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith(CHECKOUT.redirectUrl),
    );
    expect(result.current.hold).toEqual({
      label: "Gradin, Rang B, place 2",
      expiresAt: CHECKOUT.expiresAt,
      resumed: false,
    });

    await act(() => result.current.selectSeat("g1", 4));
    expect(result.current.selection).toBeNull();
  });

  it("books a free placement without a seat index", async () => {
    const { result } = await renderReady();

    await act(() => result.current.selectFreeElement("o1"));
    expect(result.current.selection).toEqual({ itemId: "o1" });

    await act(() => result.current.pay());
    expect(checkout).toHaveBeenCalledWith({
      competitionId: "c1",
      itemId: "o1",
      seatIndex: undefined,
      seatLabel: undefined,
    });
  });

  it("preselects the user's own held seat (resumes its payment)", async () => {
    getOccupancy.mockResolvedValue({
      competitionId: "c1",
      elements: [numbered({ mySeats: [1], mine: 1 }), free],
    });
    const { result } = await renderReady();

    expect(result.current.selection).toEqual({ itemId: "g1", seatIndex: 1 });
  });

  it("on a 409, shows the server message, drops the seat and reloads the plan", async () => {
    const message =
      "Cette place est déjà réservée. Choisissez une autre place.";
    checkout.mockRejectedValue(new SeatBookingError("conflict", message, 409));
    const { result } = await renderReady();
    expect(getOccupancy).toHaveBeenCalledTimes(1);

    await act(() => result.current.selectSeat("g1", 2));
    // Meanwhile someone took seat 2: the refresh reports it.
    getOccupancy.mockResolvedValue({
      competitionId: "c1",
      elements: [numbered({ takenSeats: [0, 2] }), free],
    });
    await act(() => result.current.pay());

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith("Place indisponible", message),
    );
    expect(result.current.selection).toBeNull();
    await waitFor(() => expect(getOccupancy).toHaveBeenCalledTimes(2));
    expect(openUrl).not.toHaveBeenCalled();

    // The user picks another seat.
    await act(() => result.current.selectSeat("g1", 3));
    expect(result.current.selection).toEqual({ itemId: "g1", seatIndex: 3 });
  });

  it("drops a chosen seat that a refresh shows as taken", async () => {
    const { result } = await renderReady();
    await act(() => result.current.selectSeat("g1", 2));

    getOccupancy.mockResolvedValue({
      competitionId: "c1",
      elements: [numbered({ heldSeats: [1, 2] }), free],
    });
    await act(() => refocus());

    await waitFor(() => expect(result.current.selection).toBeNull());
  });

  it("on a 503, offers to retry the same checkout", async () => {
    checkout
      .mockRejectedValueOnce(
        new SeatBookingError(
          "unavailable",
          SEAT_BOOKING_MESSAGES.unavailable,
          503,
        ),
      )
      .mockResolvedValueOnce({ ...CHECKOUT, resumed: true });
    const { result } = await renderReady();
    await act(() => result.current.selectSeat("g1", 4));

    await act(() => result.current.pay());
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const [title, text, buttons] = alertSpy.mock.calls[0] as [
      string,
      string,
      AlertButton[],
    ];
    expect(title).toBe("Paiement indisponible");
    expect(text).toBe(SEAT_BOOKING_MESSAGES.unavailable);
    const retry = buttons.find((b) => b.text === "Réessayer");

    await act(() => retry?.onPress?.());
    await waitFor(() => expect(checkout).toHaveBeenCalledTimes(2));
    expect(checkout.mock.calls[1][0]).toEqual(checkout.mock.calls[0][0]);
    await waitFor(() => expect(result.current.hold?.resumed).toBe(true));
  });

  it("shows other refusals as is", async () => {
    checkout.mockRejectedValue(
      new SeatBookingError("other", "Cette place n'est pas réservable.", 400),
    );
    const { result } = await renderReady();
    await act(() => result.current.selectSeat("g1", 4));
    await act(() => result.current.pay());

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        "Réservation impossible",
        "Cette place n'est pas réservable.",
      ),
    );
    expect(result.current.selection).toEqual({ itemId: "g1", seatIndex: 4 });
  });

  it("does nothing on pay without a selection", async () => {
    const { result } = await renderReady();
    await act(() => result.current.pay());
    expect(checkout).not.toHaveBeenCalled();
  });

  it("reloads the occupancy on refocus, never by itself", async () => {
    jest.useFakeTimers();
    try {
      const { result } = await renderReady();
      expect(result.current.elements).toHaveLength(2);
      expect(getOccupancy).toHaveBeenCalledTimes(1);

      await act(() => jest.advanceTimersByTime(10 * 60_000));
      expect(getOccupancy).toHaveBeenCalledTimes(1);

      await act(() => refocus());
      await waitFor(() => expect(getOccupancy).toHaveBeenCalledTimes(2));
    } finally {
      jest.useRealTimers();
    }
  });

  it("reports a load error and reloads on demand", async () => {
    getOccupancy.mockRejectedValueOnce(
      new SeatBookingError("other", SEAT_BOOKING_MESSAGES.occupancy, 500),
    );
    const { result } = await renderHook(() => useSeatBooking("c1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    await act(() => result.current.reload());
    await waitFor(() => expect(result.current.isError).toBe(false));
    expect(result.current.elements).toHaveLength(2);
  });
});
