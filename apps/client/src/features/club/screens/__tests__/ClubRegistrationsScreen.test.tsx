import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import { Alert } from "react-native";
import {
  competitionsControllerConfirmRegistration,
  competitionsControllerGetClubPendingRegistrations,
  competitionsControllerUnregisterMember,
} from "../../../../api/generated/sdk.gen";
import { useTheme } from "../../../../context/ThemeContext";
import { ClubService } from "../../services/ClubService";
import { ClubRegistrationsScreen } from "../ClubRegistrationsScreen";

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
  competitionsControllerGetClubPendingRegistrations: jest.fn(),
  competitionsControllerConfirmRegistration: jest.fn(),
  competitionsControllerUnregisterMember: jest.fn(),
}));

jest.mock("../../services/ClubService");

const pendingMock =
  competitionsControllerGetClubPendingRegistrations as jest.Mock;
const confirmMock = competitionsControllerConfirmRegistration as jest.Mock;
const unregisterMock = competitionsControllerUnregisterMember as jest.Mock;

const buildRow = (overrides: Record<string, unknown> = {}) => ({
  id: "reg-1",
  eventId: "evt-1",
  userId: "usr-1",
  createdAt: new Date().toISOString(),
  partnerName: "Partenaire Test",
  status: "PENDING",
  user: {
    id: "usr-1",
    firstName: "Eelef",
    lastName: "Testeur",
    email: "eelef@example.com",
    clubName: "E2E Test Club",
  },
  event: {
    id: "evt-1",
    category: "Latine",
    ageGroup: "Adulte",
    eventType: "COUPLE",
    competitionId: "comp-1",
  },
  competition: {
    id: "comp-1",
    title: "Gala Latin E2E Connect",
    date: "2026-08-01",
  },
  ...overrides,
});

describe("ClubRegistrationsScreen", () => {
  const mockTheme = {
    background: "#fff",
    surface: "#f2f2f2",
    text: "#111",
    textSecondary: "#666",
    primary: "#3b82f6",
    border: "#e5e7eb",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    (useTheme as jest.Mock).mockReturnValue({ theme: mockTheme });
    (ClubService.getMyClubRegistrationMode as jest.Mock).mockResolvedValue({
      registrationMode: "CLUB_AND_MEMBERS_PENDING",
    });
    pendingMock.mockResolvedValue({ data: [buildRow()] });
    confirmMock.mockResolvedValue({ data: {} });
    unregisterMock.mockResolvedValue({ data: {} });
  });

  it("renders pending registrations from the real endpoint", async () => {
    const { getByText } = await render(<ClubRegistrationsScreen />);

    await waitFor(() => {
      expect(getByText("Eelef Testeur")).toBeTruthy();
    });
    expect(getByText("Gala Latin E2E Connect")).toBeTruthy();
    expect(getByText("Latine - Adulte")).toBeTruthy();
  });

  it("confirms an approval against the confirm endpoint with the registration id", async () => {
    const { getByText } = await render(<ClubRegistrationsScreen />);
    await waitFor(() => expect(getByText("Eelef Testeur")).toBeTruthy());

    await fireEvent.press(getByText("Valider"));
    expect(Alert.alert).toHaveBeenCalled();

    // Fire the "Confirmer" action from the alert.
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    const confirm = buttons.find(
      (b: { text: string }) => b.text === "Confirmer",
    );
    await confirm.onPress();

    expect(confirmMock).toHaveBeenCalledWith({
      path: { registrationId: "reg-1" },
    });
  });

  it("rejects via the unregister-member endpoint with event and user ids", async () => {
    const { getByText } = await render(<ClubRegistrationsScreen />);
    await waitFor(() => expect(getByText("Eelef Testeur")).toBeTruthy());

    await fireEvent.press(getByText("Refuser"));
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    const confirm = buttons.find(
      (b: { text: string }) => b.text === "Confirmer",
    );
    await confirm.onPress();

    expect(unregisterMock).toHaveBeenCalledWith({
      body: { eventId: "evt-1", userId: "usr-1" },
    });
  });

  it("restores the row and alerts when the confirm call fails", async () => {
    confirmMock.mockResolvedValue({ error: { statusCode: 500 } });
    const { getByText } = await render(<ClubRegistrationsScreen />);
    await waitFor(() => expect(getByText("Eelef Testeur")).toBeTruthy());

    await fireEvent.press(getByText("Valider"));
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    const confirm = buttons.find(
      (b: { text: string }) => b.text === "Confirmer",
    );
    await confirm.onPress();

    // Optimistic removal is reverted: the seeded dancer is back on screen.
    await waitFor(() => expect(getByText("Eelef Testeur")).toBeTruthy());
    expect(Alert.alert).toHaveBeenCalledWith("Erreur", expect.any(String));
  });

  it("shows an error empty-state when the endpoint fails", async () => {
    pendingMock.mockResolvedValue({ error: { statusCode: 500 } });
    const { getByText } = await render(<ClubRegistrationsScreen />);

    await waitFor(() => {
      expect(getByText("Chargement impossible")).toBeTruthy();
    });
  });
});
