import {
  paymentControllerCreateCheckout,
  seatOccupancyControllerGetSeatOccupancy,
} from "../../../api/generated";
import { ERROR_MESSAGES } from "../../../constants/errorMessages";
import {
  SEAT_BOOKING_MESSAGES,
  SeatBookingApi,
  SeatBookingError,
} from "../seat-booking-api";

jest.mock("../../../api/client", () => ({}));
jest.mock("../../../api/generated", () => ({
  paymentControllerCreateCheckout: jest.fn(),
  seatOccupancyControllerGetSeatOccupancy: jest.fn(),
}));

const checkoutMock = paymentControllerCreateCheckout as jest.Mock;
const occupancyMock = seatOccupancyControllerGetSeatOccupancy as jest.Mock;

const ok = <T>(data: T) => ({
  data,
  error: undefined,
  response: { status: 200 },
});
const fail = (status: number, message?: unknown) => ({
  data: undefined,
  error: { statusCode: status, message },
  response: { status },
});

const CHECKOUT = {
  id: 42,
  redirectUrl: "https://www.helloasso.com/pay/42",
  bookingId: "b1",
  seatIndex: 4,
  expiresAt: "2026-10-15T12:00:00.000Z",
  resumed: false,
};

async function checkoutError(): Promise<SeatBookingError> {
  try {
    await SeatBookingApi.checkout({ competitionId: "c1", itemId: "t1" });
  } catch (error) {
    if (error instanceof SeatBookingError) return error;
    throw error;
  }
  throw new Error("checkout did not fail");
}

beforeEach(() => jest.clearAllMocks());

describe("SeatBookingApi.getOccupancy", () => {
  it("reads the occupancy of the competition", async () => {
    const data = { competitionId: "c1", elements: [] };
    occupancyMock.mockResolvedValue(ok(data));

    await expect(SeatBookingApi.getOccupancy("c1")).resolves.toBe(data);
    expect(occupancyMock).toHaveBeenCalledWith({ path: { id: "c1" } });
  });

  it("fails with a French message", async () => {
    occupancyMock.mockResolvedValue(fail(404, "Competition not found"));

    await expect(SeatBookingApi.getOccupancy("c1")).rejects.toMatchObject({
      userMessage: SEAT_BOOKING_MESSAGES.occupancy,
      status: 404,
    });
  });
});

describe("SeatBookingApi.checkout", () => {
  it("sends the chosen seat of a numbered element", async () => {
    checkoutMock.mockResolvedValue(ok(CHECKOUT));

    await expect(
      SeatBookingApi.checkout({
        competitionId: "c1",
        itemId: "g1",
        seatIndex: 9,
        seatLabel: "Rang C, place 2",
      }),
    ).resolves.toBe(CHECKOUT);
    expect(checkoutMock).toHaveBeenCalledWith({
      body: {
        competitionId: "c1",
        itemId: "g1",
        seatIndex: 9,
        seatLabel: "Rang C, place 2",
      },
    });
  });

  it("sends seat 0 (falsy but valid)", async () => {
    checkoutMock.mockResolvedValue(ok(CHECKOUT));

    await SeatBookingApi.checkout({
      competitionId: "c1",
      itemId: "t1",
      seatIndex: 0,
    });
    expect(checkoutMock.mock.calls[0][0].body.seatIndex).toBe(0);
  });

  it("sends no seat index for a free placement", async () => {
    checkoutMock.mockResolvedValue(ok({ ...CHECKOUT, seatIndex: null }));

    await SeatBookingApi.checkout({ competitionId: "c1", itemId: "o1" });
    expect(checkoutMock).toHaveBeenCalledWith({
      body: { competitionId: "c1", itemId: "o1" },
    });
  });

  it("passes a 409 server message through as is (cooldown, seat taken…)", async () => {
    const cooldown =
      "Vous avez laissé expirer votre réservation de cette place. Vous pourrez la réserver de nouveau dans 10 minutes.";
    checkoutMock.mockResolvedValue(fail(409, cooldown));

    const error = await checkoutError();
    expect(error.kind).toBe("conflict");
    expect(error.userMessage).toBe(cooldown);
    // Logs and Sentry read `message`: no user-facing text there.
    expect(error.message).not.toContain("expirer");
  });

  it("falls back to a French message on a 409 without text", async () => {
    checkoutMock.mockResolvedValue(fail(409, ["a", "b"]));

    const error = await checkoutError();
    expect(error.userMessage).toBe(SEAT_BOOKING_MESSAGES.conflict);
  });

  it("flags a 503 as retryable", async () => {
    checkoutMock.mockResolvedValue(fail(503, "HelloAsso down"));

    const error = await checkoutError();
    expect(error.kind).toBe("unavailable");
    expect(error.userMessage).toBe(SEAT_BOOKING_MESSAGES.unavailable);
  });

  it("shows the server reason of a 400, a generic text otherwise", async () => {
    checkoutMock.mockResolvedValueOnce(
      fail(400, "Cette place n'est pas réservable."),
    );
    expect((await checkoutError()).userMessage).toBe(
      "Cette place n'est pas réservable.",
    );

    checkoutMock.mockResolvedValueOnce(fail(500, "Internal server error"));
    const error = await checkoutError();
    expect(error.kind).toBe("other");
    expect(error.userMessage).toBe(SEAT_BOOKING_MESSAGES.checkout);
  });

  it("turns a network failure into a French message", async () => {
    checkoutMock.mockRejectedValue(new TypeError("Network request failed"));

    const error = await checkoutError();
    expect(error.kind).toBe("other");
    expect(error.userMessage).toBe(ERROR_MESSAGES.NETWORK_ERROR);
  });
});
