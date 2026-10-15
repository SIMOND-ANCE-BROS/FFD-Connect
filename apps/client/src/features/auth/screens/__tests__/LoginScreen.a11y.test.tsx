import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { mockUseTheme } from "../../../../__tests__/mocks/mockTheme";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { useLoginLogic } from "../../hooks/useLoginLogic";
import { LoginScreen } from "../LoginScreen";
import { preloadReactNative } from "../../../../__tests__/mocks/preloadReactNative";

// Screen-reader contract of the login screen (RGAA, issue #22): French
// names on every control, no technical testID read aloud.

jest.mock("../../hooks/useLoginLogic");

const mockUseThemeFn = jest.fn(() =>
  (
    require("../../../../__tests__/mocks/mockTheme") as typeof import("../../../../__tests__/mocks/mockTheme")
  ).mockUseTheme(),
);
jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => mockUseThemeFn(),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("../../../../utils/biometrics-adapter", () => ({
  __esModule: true,
  default: {
    isSensorAvailable: jest.fn().mockResolvedValue({ available: false }),
    simplePrompt: jest.fn().mockResolvedValue({ success: false }),
  },
}));

jest.mock("../../../../components/AnimatedComponents", () => ({
  FadeInView: ({ children }: { children: React.ReactNode }) => children,
}));

preloadReactNative("ScrollView", "TextInput", "KeyboardAvoidingView");

const actions = {
  setUsername: jest.fn(),
  setPassword: jest.fn(),
  togglePasswordVisibility: jest.fn(),
  setFocusedField: jest.fn(),
  onLogin: jest.fn().mockResolvedValue(undefined),
  onBiometricLogin: jest.fn().mockResolvedValue(undefined),
  onGuestLogin: jest.fn().mockResolvedValue(undefined),
  onForgotPassword: jest.fn(),
};

const renderLogin = (state: Record<string, unknown> = {}) => {
  (useLoginLogic as jest.Mock).mockReturnValue({
    state: {
      username: "",
      password: "",
      loading: false,
      isPasswordVisible: false,
      focusedField: null,
      isBiometricAvailable: false,
      ...state,
    },
    actions,
  });
  return render(<LoginScreen {...createMockScreenProps("Login", undefined)} />);
};

describe("LoginScreen accessibility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseThemeFn.mockImplementation(() => mockUseTheme());
  });

  it("names the inputs in French and keeps their testIDs", async () => {
    const { getByLabelText } = await renderLogin();
    expect(getByLabelText("E-mail").props.testID).toBe("login-email-input");
    expect(getByLabelText("Mot de passe").props.testID).toBe(
      "login-password-input",
    );
  });

  it("exposes the screen title as a heading", async () => {
    const { getByRole } = await renderLogin();
    expect(getByRole("header", { name: "FFD Connect" })).toBeTruthy();
  });

  it("labels the password toggle with the action it performs", async () => {
    const { getByRole, rerender } = await renderLogin();
    await fireEvent.press(
      getByRole("button", { name: "Afficher le mot de passe" }),
    );
    expect(actions.togglePasswordVisibility).toHaveBeenCalled();

    (useLoginLogic as jest.Mock).mockReturnValue({
      state: {
        username: "",
        password: "",
        loading: false,
        isPasswordVisible: true,
        focusedField: null,
        isBiometricAvailable: false,
      },
      actions,
    });
    await rerender(
      <LoginScreen {...createMockScreenProps("Login", undefined)} />,
    );
    expect(
      getByRole("button", { name: "Masquer le mot de passe" }),
    ).toBeTruthy();
  });

  it("names every button in French", async () => {
    const { getByRole } = await renderLogin({ isBiometricAvailable: true });
    expect(getByRole("button", { name: "Se connecter" })).toBeTruthy();
    expect(getByRole("button", { name: "Connexion biométrique" })).toBeTruthy();
    expect(getByRole("button", { name: "Mot de passe oublié ?" })).toBeTruthy();
    expect(getByRole("button", { name: "Créer un compte" })).toBeTruthy();
    expect(
      getByRole("button", { name: "Continuer en tant qu'invité" }),
    ).toBeTruthy();
  });

  it("does not read the visual field captions twice", async () => {
    const { queryByText } = await renderLogin();
    // Hidden from assistive tech (the inputs carry the same name).
    expect(queryByText("E-MAIL")).toBeNull();
    expect(queryByText("E-MAIL", { includeHiddenElements: true })).toBeTruthy();
  });
});
