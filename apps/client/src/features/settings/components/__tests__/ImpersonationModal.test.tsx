import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import api from "../../../../services/api";
import { AuthService } from "../../../auth/services/AuthService";
import { ImpersonationModal } from "../ImpersonationModal";

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      surface: "#fff",
      text: "#000",
      textSecondary: "#666",
      primary: "#007AFF",
      background: "#fafafa",
      border: "#ccc",
    },
    isDark: false,
  }),
}));

jest.mock("../../../../services/api", () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));
jest.mock("../../../auth/services/AuthService", () => ({
  AuthService: { impersonate: jest.fn().mockResolvedValue(undefined) },
}));

const mockRefresh = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../../stores/auth.store", () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ refreshAuth: mockRefresh }),
}));

beforeEach(() => jest.clearAllMocks());

describe("ImpersonationModal", () => {
  it("recherche puis impersonne le résultat sélectionné", async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        {
          id: "u1",
          email: "club@test.com",
          firstName: "Test",
          lastName: "Club",
          role: "CLUB",
        },
      ],
    });

    const { getByTestId } = await render(
      <ImpersonationModal visible onClose={jest.fn()} />,
    );

    await fireEvent.changeText(
      getByTestId("impersonation-search-input"),
      "club",
    );

    const row = await waitFor(() => getByTestId("impersonation-result-u1"));
    expect(api.get).toHaveBeenCalledWith(
      "/users/search",
      expect.objectContaining({ params: { q: "club" } }),
    );

    await fireEvent.press(row);
    await waitFor(() => {
      expect(AuthService.impersonate).toHaveBeenCalledWith("u1", "Test Club");
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it("ne cherche pas sous 2 caractères", async () => {
    const { getByTestId } = await render(
      <ImpersonationModal visible onClose={jest.fn()} />,
    );
    await fireEvent.changeText(getByTestId("impersonation-search-input"), "a");
    await waitFor(() => {
      expect(api.get).not.toHaveBeenCalled();
    });
  });

  it("affiche « Aucun utilisateur trouvé » quand la recherche ne renvoie rien", async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [] });
    const { getByTestId, getByText } = await render(
      <ImpersonationModal visible onClose={jest.fn()} />,
    );
    await fireEvent.changeText(
      getByTestId("impersonation-search-input"),
      "zzz",
    );
    await waitFor(() => {
      expect(getByText("Aucun utilisateur trouvé.")).toBeTruthy();
    });
  });
});
