import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { AuthService } from "../../services/AuthService";
import { ForgotPasswordScreen } from "../ForgotPasswordScreen";

jest.mock("../../services/AuthService", () => ({
  AuthService: {
    forgotPassword: jest.fn(),
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

describe("ForgotPasswordScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AuthService.forgotPassword as jest.Mock).mockResolvedValue(undefined);
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

  const createTestProps = () =>
    createMockScreenProps("ForgotPassword", undefined);

  it("renders correctly", async () => {
    const { getByText, getByTestId } = await render(
      <ForgotPasswordScreen {...createTestProps()} />,
    );

    expect(getByText("Mot de passe oublié")).toBeTruthy();
    expect(getByTestId("forgot-password-email-input")).toBeTruthy();
    expect(getByText("Envoyer")).toBeTruthy();
  });

  it("shows alert when email is empty", async () => {
    const { getByTestId } = await render(
      <ForgotPasswordScreen {...createTestProps()} />,
    );

    await act(async () => {
      await fireEvent.press(getByTestId("forgot-password-submit"));
    });

    expect(mockAlert).toHaveBeenCalledWith(
      "Erreur",
      "Veuillez entrer votre adresse email.",
    );
    expect(AuthService.forgotPassword as jest.Mock).not.toHaveBeenCalled();
  });

  it("shows alert when email is invalid", async () => {
    const { getByTestId } = await render(
      <ForgotPasswordScreen {...createTestProps()} />,
    );

    await fireEvent.changeText(
      getByTestId("forgot-password-email-input"),
      "invalid-email",
    );

    await act(async () => {
      await fireEvent.press(getByTestId("forgot-password-submit"));
    });

    expect(mockAlert).toHaveBeenCalledWith(
      "Erreur",
      "Veuillez entrer une adresse email valide.",
    );
    expect(AuthService.forgotPassword as jest.Mock).not.toHaveBeenCalled();
  });

  it("calls AuthService.forgotPassword when email is valid", async () => {
    const { getByTestId } = await render(
      <ForgotPasswordScreen {...createTestProps()} />,
    );

    await fireEvent.changeText(
      getByTestId("forgot-password-email-input"),
      "user@example.com",
    );

    await act(async () => {
      await fireEvent.press(getByTestId("forgot-password-submit"));
    });

    await waitFor(() => {
      expect(AuthService.forgotPassword as jest.Mock).toHaveBeenCalledWith(
        "user@example.com",
      );
    });
    expect(mockAlert).toHaveBeenCalledWith(
      "Email envoyé",
      expect.stringContaining("Si cette adresse email existe"),
      expect.any(Array),
    );
  });

  it("trims email before validation", async () => {
    const { getByTestId } = await render(
      <ForgotPasswordScreen {...createTestProps()} />,
    );

    await fireEvent.changeText(
      getByTestId("forgot-password-email-input"),
      "  user@example.com  ",
    );

    await act(async () => {
      await fireEvent.press(getByTestId("forgot-password-submit"));
    });

    await waitFor(() => {
      expect(AuthService.forgotPassword as jest.Mock).toHaveBeenCalledWith(
        "user@example.com",
      );
    });

    expect(AuthService.forgotPassword as jest.Mock).toHaveBeenCalledWith(
      "user@example.com",
    );
  });

  it("calls goBack when back button is pressed", async () => {
    const props = createTestProps();
    const { getByText } = await render(<ForgotPasswordScreen {...props} />);

    await fireEvent.press(getByText("Retour à la connexion"));

    expect(props.navigation.goBack).toHaveBeenCalled();
  });
});
