import { render, waitFor } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import { clubRefundsDueControllerList } from "../../../../api/generated/sdk.gen";
import { useTheme } from "../../../../context/ThemeContext";
import {
  ClubRefundsDueScreen,
  formatRefundAmount,
} from "../ClubRefundsDueScreen";

jest.mock("../../../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useTheme: jest.fn(),
}));

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));

// Configure-client side-effect is irrelevant in tests.
jest.mock("../../../../api/client", () => ({}));
jest.mock("../../../../api/generated/sdk.gen", () => ({
  clubRefundsDueControllerList: jest.fn(),
}));

const listMock = clubRefundsDueControllerList as jest.Mock;

const buildRefund = (overrides: Record<string, unknown> = {}) => ({
  bookingId: "booking-1",
  competition: {
    id: "comp-1",
    title: "Open de Lyon",
    date: "2026-11-01T00:00:00.000Z",
  },
  dancer: { firstName: "Jeanne", lastName: "Martin" },
  seatNumber: 5,
  amountCents: 1550,
  helloAssoCheckoutIntentIds: ["111"],
  refundOwedAt: "2026-10-12T10:00:00.000Z",
  ...overrides,
});

const page = (
  data: ReturnType<typeof buildRefund>[],
  hasMore = false,
  total = data.length,
) => ({
  data: { data, meta: { total, skip: 0, take: 20, hasMore } },
});

describe("ClubRefundsDueScreen (#516)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useTheme as jest.Mock).mockReturnValue({
      theme: {
        background: "#fff",
        surface: "#f2f2f2",
        text: "#111",
        textSecondary: "#666",
        primary: "#3b82f6",
        border: "#e5e7eb",
      },
      isDark: false,
    });
  });

  it("lists each refund due with competition, dancer, seat, amount and HelloAsso reference", async () => {
    listMock.mockResolvedValue(page([buildRefund()]));

    const { getByText, getByTestId } = await render(<ClubRefundsDueScreen />);

    await waitFor(() => {
      expect(getByText("Jeanne Martin")).toBeTruthy();
    });
    expect(listMock).toHaveBeenCalledWith({ query: { skip: 0, take: 20 } });
    expect(getByText(/Open de Lyon/)).toBeTruthy();
    expect(getByText("Place 5")).toBeTruthy();
    expect(getByText(/1 paiement de 15,50\s€ à rembourser/)).toBeTruthy();
    expect(getByText(/Référence HelloAsso : 111/)).toBeTruthy();
    expect(getByText(/Depuis le 12 octobre 2026/)).toBeTruthy();
    expect(getByTestId("club-refunds-intro")).toBeTruthy();
  });

  it("groups several payments of one booking and omits unknown seat and amount", async () => {
    listMock.mockResolvedValue(
      page([
        buildRefund({
          seatNumber: null,
          amountCents: null,
          helloAssoCheckoutIntentIds: ["111", "222"],
        }),
      ]),
    );

    const { getByText, queryByText } = await render(<ClubRefundsDueScreen />);

    await waitFor(() => {
      expect(getByText("2 paiements à rembourser")).toBeTruthy();
    });
    expect(getByText(/Références HelloAsso : 111, 222/)).toBeTruthy();
    expect(queryByText(/^Place /)).toBeNull();
  });

  it("says when nothing is due", async () => {
    listMock.mockResolvedValue(page([]));

    const { getByText, queryByTestId } = await render(<ClubRefundsDueScreen />);

    await waitFor(() => {
      expect(getByText("Aucun remboursement dû")).toBeTruthy();
    });
    expect(queryByTestId("club-refunds-intro")).toBeNull();
  });

  it("shows a loading error when the API answers an error", async () => {
    listMock.mockResolvedValue({ data: undefined, error: { status: 403 } });

    const { getByText } = await render(<ClubRefundsDueScreen />);

    await waitFor(() => {
      expect(getByText("Chargement impossible")).toBeTruthy();
    });
  });

  it("shows a loading error when the request fails", async () => {
    listMock.mockRejectedValue(new Error("network"));

    const { getByText } = await render(<ClubRefundsDueScreen />);

    await waitFor(() => {
      expect(getByText("Chargement impossible")).toBeTruthy();
    });
  });

  it("formats amounts in euros", () => {
    expect(formatRefundAmount(1550)).toMatch(/^15,50\s€$/);
    expect(formatRefundAmount(null)).toBe("");
  });

  describe("screen reader (#22)", () => {
    it("reads a refund as one sentence and keeps the reference apart", async () => {
      listMock.mockResolvedValue(page([buildRefund()]));

      const { findByLabelText, getByText, getByRole } = await render(
        <ClubRefundsDueScreen />,
      );

      expect(
        await findByLabelText(
          /^Jeanne Martin, à rembourser, 1 paiement de 15,50\s€ à rembourser, Open de Lyon, 1 novembre 2026, place 5, depuis le 12 octobre 2026$/,
        ),
      ).toBeTruthy();
      // The HelloAsso reference stays its own (selectable) element.
      expect(getByText(/Référence HelloAsso : 111/)).toBeTruthy();
      expect(getByRole("header", { name: "Remboursements" })).toBeTruthy();
    });

    it("exposes the empty / error title as a heading", async () => {
      listMock.mockRejectedValue(new Error("network"));

      const { findByRole } = await render(<ClubRefundsDueScreen />);

      expect(
        await findByRole("header", { name: "Chargement impossible" }),
      ).toBeTruthy();
    });
  });
});
