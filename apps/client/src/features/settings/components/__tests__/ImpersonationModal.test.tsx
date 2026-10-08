import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Keyboard } from "react-native";
import api from "../../../../services/api";
import { AuthService } from "../../../auth/services/AuthService";
import {
  IMPERSONATION_SEARCH_DEBOUNCE_MS,
  ImpersonationModal,
} from "../ImpersonationModal";

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

const USER = {
  id: "u1",
  email: "club@test.com",
  firstName: "Test",
  lastName: "Club",
  role: "CLUB",
};

let dismissSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  dismissSpy = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => {});
});
afterEach(() => {
  dismissSpy.mockRestore();
  jest.useRealTimers();
});

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

  it("garde le clavier ouvert quand les résultats arrivent (pas d'éjection pendant la saisie)", async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [USER] });
    const { getByTestId } = await render(
      <ImpersonationModal visible onClose={jest.fn()} />,
    );
    await fireEvent.changeText(
      getByTestId("impersonation-search-input"),
      "club",
    );
    await waitFor(() => getByTestId("impersonation-result-u1"));
    expect(Keyboard.dismiss).not.toHaveBeenCalled();
    expect(getByTestId("impersonation-search-input").props.value).toBe("club");
  });

  it("debounce : une seule requête pour une rafale de frappes", async () => {
    jest.useFakeTimers();
    (api.get as jest.Mock).mockResolvedValue({ data: [] });
    const { getByTestId } = await render(
      <ImpersonationModal visible onClose={jest.fn()} />,
    );
    const input = getByTestId("impersonation-search-input");
    await fireEvent.changeText(input, "cl");
    await fireEvent.changeText(input, "clu");
    await fireEvent.changeText(input, "club");
    expect(api.get).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(IMPERSONATION_SEARCH_DEBOUNCE_MS);
    });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith(
      "/users/search",
      expect.objectContaining({ params: { q: "club" } }),
    );
  });

  it("ignore une réponse obsolète arrivée après une recherche plus récente", async () => {
    let resolveOld: (v: unknown) => void = () => {};
    (api.get as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveOld = r;
          }),
      )
      .mockResolvedValueOnce({ data: [USER] });
    const { getByTestId, queryByTestId } = await render(
      <ImpersonationModal visible onClose={jest.fn()} />,
    );
    const input = getByTestId("impersonation-search-input");
    await fireEvent.changeText(input, "zz");
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    await fireEvent.changeText(input, "club");
    await waitFor(() => getByTestId("impersonation-result-u1"));
    await act(async () => {
      resolveOld({ data: [] });
    });
    expect(queryByTestId("impersonation-result-u1")).toBeTruthy();
  });

  it("ferme en un seul tap sur le fond, clavier compris, et réinitialise la recherche", async () => {
    const onClose = jest.fn();
    const { getByTestId } = await render(
      <ImpersonationModal visible onClose={onClose} />,
    );
    await fireEvent.changeText(getByTestId("impersonation-search-input"), "a");
    await fireEvent.press(getByTestId("impersonation-backdrop"));
    expect(Keyboard.dismiss).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getByTestId("impersonation-search-input").props.value).toBe("");
  });

  it("ferme via le bouton ✕ de l'en-tête", async () => {
    const onClose = jest.fn();
    const { getByTestId } = await render(
      <ImpersonationModal visible onClose={onClose} />,
    );
    await fireEvent.press(getByTestId("impersonation-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("garde les taps sur les résultats même clavier ouvert", async () => {
    const { getByTestId } = await render(
      <ImpersonationModal visible onClose={jest.fn()} />,
    );
    expect(
      getByTestId("impersonation-results").props.keyboardShouldPersistTaps,
    ).toBe("handled");
  });
});
