import { act, fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
import { useTheme, ThemeContextType } from "../../../../context/ThemeContext";
import { ClubService } from "../../../club/services/ClubService";
import { HelloAssoModal } from "../HelloAssoModal";

jest.mock("../../../../context/ThemeContext");
jest.mock("../../../club/services/ClubService", () => ({
  ClubService: { connectHelloAsso: jest.fn() },
}));
jest.mock("../../../../components/AppButton");
jest.mock("../../../../components/AppText");

const mockUseTheme = useTheme as jest.MockedFunction<typeof useTheme>;
const mockConnect = ClubService.connectHelloAsso as jest.MockedFunction<
  typeof ClubService.connectHelloAsso
>;

const theme = {
  background: "#fff",
  surface: "#f7f7f7",
  text: "#111",
  textSecondary: "#666",
  border: "#e0e0e0",
  primary: "#004481",
};

describe("HelloAssoModal", () => {
  const onClose = jest.fn();
  const onSuccess = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseTheme.mockReturnValue({ theme } as unknown as ThemeContextType);
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  async function renderModal(visible = true) {
    return await render(
      <HelloAssoModal
        visible={visible}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );
  }

  it("renders the title when visible", async () => {
    const { getAllByText } = await renderModal();
    expect(getAllByText("Connecter HelloAsso").length).toBeGreaterThan(0);
  });

  it("calls onClose when cancel button is pressed", async () => {
    const { getByTestId } = await renderModal();
    await fireEvent.press(getByTestId("btn-Annuler"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when close button (✕) is pressed", async () => {
    const { getByText } = await renderModal();
    await fireEvent.press(getByText("✕"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows error alert when fields are empty", async () => {
    const { getByTestId } = await renderModal();
    await act(async () => {
      await fireEvent.press(getByTestId("btn-Connecter"));
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      "Erreur",
      expect.stringMatching(/remplir/i),
    );
  });

  it("shows error when only some fields are filled", async () => {
    const { getByPlaceholderText, getByTestId } = await renderModal();
    await fireEvent.changeText(
      getByPlaceholderText("Client ID"),
      "my-client-id",
    );
    await act(async () => {
      await fireEvent.press(getByTestId("btn-Connecter"));
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      "Erreur",
      expect.stringMatching(/remplir/i),
    );
  });

  it("calls ClubService.connectHelloAsso with trimmed values on valid submit", async () => {
    mockConnect.mockResolvedValue(undefined as any);
    const { getByPlaceholderText, getByTestId } = await renderModal();

    await fireEvent.changeText(getByPlaceholderText("Client ID"), "  my-id  ");
    await fireEvent.changeText(
      getByPlaceholderText("Client Secret"),
      "  my-secret  ",
    );
    await fireEvent.changeText(
      getByPlaceholderText("ex: mon-club-danse"),
      "  mon-club  ",
    );

    await act(async () => {
      await fireEvent.press(getByTestId("btn-Connecter"));
    });

    expect(mockConnect).toHaveBeenCalledWith({
      clientId: "my-id",
      clientSecret: "my-secret",
      organizationSlug: "mon-club",
    });
  });

  it("shows success alert after successful connection", async () => {
    mockConnect.mockResolvedValue(undefined as any);
    const { getByPlaceholderText, getByTestId } = await renderModal();

    await fireEvent.changeText(getByPlaceholderText("Client ID"), "id");
    await fireEvent.changeText(getByPlaceholderText("Client Secret"), "secret");
    await fireEvent.changeText(
      getByPlaceholderText("ex: mon-club-danse"),
      "slug",
    );

    await act(async () => {
      await fireEvent.press(getByTestId("btn-Connecter"));
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      "Compte connecté",
      expect.stringMatching(/HelloAsso/),
      expect.any(Array),
    );
  });

  it("shows fallback error message when ClubService throws without response data", async () => {
    mockConnect.mockRejectedValue(new Error("Unauthorized"));
    const { getByPlaceholderText, getByTestId } = await renderModal();

    await fireEvent.changeText(getByPlaceholderText("Client ID"), "id");
    await fireEvent.changeText(getByPlaceholderText("Client Secret"), "secret");
    await fireEvent.changeText(
      getByPlaceholderText("ex: mon-club-danse"),
      "slug",
    );

    await act(async () => {
      await fireEvent.press(getByTestId("btn-Connecter"));
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      "Erreur",
      expect.stringMatching(/identifiants/i),
    );
  });

  it("shows API error message from response.data.message when available", async () => {
    mockConnect.mockRejectedValue({
      response: { data: { message: "Invalid credentials" } },
    });
    const { getByPlaceholderText, getByTestId } = await renderModal();

    await fireEvent.changeText(getByPlaceholderText("Client ID"), "id");
    await fireEvent.changeText(getByPlaceholderText("Client Secret"), "secret");
    await fireEvent.changeText(
      getByPlaceholderText("ex: mon-club-danse"),
      "slug",
    );

    await act(async () => {
      await fireEvent.press(getByTestId("btn-Connecter"));
    });

    expect(Alert.alert).toHaveBeenCalledWith("Erreur", "Invalid credentials");
  });
});
