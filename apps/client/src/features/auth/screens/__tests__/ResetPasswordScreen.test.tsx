import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { AuthService } from "../../services/AuthService";
import { ResetPasswordScreen } from "../ResetPasswordScreen";

jest.mock("../../services/AuthService", () => ({
  AuthService: {
    resetPassword: jest.fn(),
  },
}));

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      background: "#ffffff",
      text: "#111111",
      textSecondary: "#666666",
      primary: "#3b82f6",
      border: "#e5e7eb",
      statusBarStyle: "dark-content",
    },
    isDark: false,
  }),
}));

jest.mock("../../../../components/AppText");

jest.mock("../../../../components/AppButton");

const mockAlert = jest.fn();
jest
  .spyOn(require("react-native").Alert, "alert")
  .mockImplementation(mockAlert);

describe("ResetPasswordScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AuthService.resetPassword as jest.Mock).mockResolvedValue(undefined);
    mockAlert.mockImplementation(
      (
        _title: string,
        _message: string,
        buttons?: Array<{ text: string; onPress?: () => void }>,
      ) => {
        buttons?.find((b) => b.onPress)?.onPress?.();
      },
    );
  });

  const createTestProps = (
    params: { token?: string } = { token: "valid-token" },
  ) => createMockScreenProps("ResetPassword", params);

  it("renders correctly", async () => {
    const { getByText, getByTestId } = await render(
      <ResetPasswordScreen {...createTestProps()} />,
    );

    expect(getByText("Réinitialiser le mot de passe")).toBeTruthy();
    expect(getByTestId("reset-password-new-input")).toBeTruthy();
    expect(getByTestId("reset-password-confirm-input")).toBeTruthy();
    expect(getByText("Réinitialiser")).toBeTruthy();
  });

  it("shows alert and navigates to Login when token is missing", async () => {
    const props = createTestProps({});
    const { getByTestId } = await render(<ResetPasswordScreen {...props} />);

    await fireEvent.changeText(
      getByTestId("reset-password-new-input"),
      "NewPass1!",
    );
    await fireEvent.changeText(
      getByTestId("reset-password-confirm-input"),
      "NewPass1!",
    );
    await fireEvent.press(getByTestId("reset-password-submit"));

    expect(mockAlert).toHaveBeenCalledWith(
      "Erreur",
      "Token de réinitialisation manquant.",
    );
    expect(props.navigation.navigate).toHaveBeenCalledWith("Login");
    expect(AuthService.resetPassword as jest.Mock).not.toHaveBeenCalled();
  });

  it("shows alert when passwords are empty", async () => {
    const { getByTestId } = await render(
      <ResetPasswordScreen {...createTestProps()} />,
    );

    await fireEvent.press(getByTestId("reset-password-submit"));

    expect(mockAlert).toHaveBeenCalledWith(
      "Erreur",
      "Veuillez remplir tous les champs.",
    );
    expect(AuthService.resetPassword as jest.Mock).not.toHaveBeenCalled();
  });

  it("shows alert when passwords do not match", async () => {
    const { getByTestId } = await render(
      <ResetPasswordScreen {...createTestProps()} />,
    );

    await fireEvent.changeText(
      getByTestId("reset-password-new-input"),
      "NewPass1!",
    );
    await fireEvent.changeText(
      getByTestId("reset-password-confirm-input"),
      "DifferentPass1!",
    );
    await fireEvent.press(getByTestId("reset-password-submit"));

    expect(mockAlert).toHaveBeenCalledWith(
      "Erreur",
      "Les mots de passe ne correspondent pas.",
    );
    expect(AuthService.resetPassword as jest.Mock).not.toHaveBeenCalled();
  });

  it("shows alert when password does not meet policy", async () => {
    const { getByTestId } = await render(
      <ResetPasswordScreen {...createTestProps()} />,
    );

    await fireEvent.changeText(getByTestId("reset-password-new-input"), "weak");
    await fireEvent.changeText(
      getByTestId("reset-password-confirm-input"),
      "weak",
    );
    await fireEvent.press(getByTestId("reset-password-submit"));

    expect(mockAlert).toHaveBeenCalledWith(
      "Mot de passe invalide",
      expect.any(String),
    );
    expect(AuthService.resetPassword as jest.Mock).not.toHaveBeenCalled();
  });

  it("calls AuthService.resetPassword when valid", async () => {
    const props = createTestProps();
    const { getByTestId } = await render(<ResetPasswordScreen {...props} />);

    await fireEvent.changeText(
      getByTestId("reset-password-new-input"),
      "ValidPass1!",
    );
    await fireEvent.changeText(
      getByTestId("reset-password-confirm-input"),
      "ValidPass1!",
    );
    await fireEvent.press(getByTestId("reset-password-submit"));

    await waitFor(() => {
      expect(AuthService.resetPassword as jest.Mock).toHaveBeenCalledWith(
        "valid-token",
        "ValidPass1!",
      );
    });
    expect(mockAlert).toHaveBeenCalledWith(
      "Succès",
      "Votre mot de passe a été réinitialisé avec succès. Vous pouvez maintenant vous connecter.",
      expect.any(Array),
    );
    expect(props.navigation.navigate).toHaveBeenCalledWith("Login");
  });

  it("navigates to Login when back link is pressed", async () => {
    const props = createTestProps();
    const { getByText } = await render(<ResetPasswordScreen {...props} />);

    await fireEvent.press(getByText("Retour à la connexion"));

    expect(props.navigation.navigate).toHaveBeenCalledWith("Login");
  });
});
