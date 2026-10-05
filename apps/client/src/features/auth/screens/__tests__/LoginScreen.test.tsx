import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { mockUseTheme } from "../../../../__tests__/mocks/mockTheme";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { useLoginLogic } from "../../hooks/useLoginLogic";
import { LoginScreen } from "../LoginScreen";

// Mock Hooks
jest.mock("../../hooks/useLoginLogic");

// Centralized mock for ThemeContext
const mockUseThemeFn = jest.fn(() =>
  (
    require("../../../../__tests__/mocks/mockTheme") as typeof import("../../../../__tests__/mocks/mockTheme")
  ).mockUseTheme(),
);
jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => mockUseThemeFn(),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Centralized mock for Navigation
jest.mock("@react-navigation/native", (): Record<string, unknown> => {
  const actual: Record<string, unknown> = jest.requireActual(
    "@react-navigation/native",
  );
  return {
    ...actual,
    useNavigation: () =>
      (
        require("../../../../__tests__/mocks/mockNavigation") as typeof import("../../../../__tests__/mocks/mockNavigation")
      ).mockNavigation,
  };
});

jest.mock("../../../../utils/biometrics-adapter", () => ({
  __esModule: true,
  default: {
    isSensorAvailable: jest.fn().mockResolvedValue({ available: false }),
    simplePrompt: jest.fn().mockResolvedValue({ success: false }),
  },
}));

jest.mock("../../../../components/AppText");
jest.mock("../../../../components/AppButton");

jest.mock("../../../../components/AnimatedComponents", () => ({
  FadeInView: ({ children }: { children: React.ReactNode }) => children,
}));

const createTestProps = () => createMockScreenProps("Login", undefined);

describe("LoginScreen", () => {
  const mockActions = {
    setUsername: jest.fn(),
    setPassword: jest.fn(),
    togglePasswordVisibility: jest.fn(),
    setFocusedField: jest.fn(),
    onLogin: jest.fn().mockResolvedValue(undefined),
    onBiometricLogin: jest.fn().mockResolvedValue(undefined),
    onGuestLogin: jest.fn().mockResolvedValue(undefined),
    onForgotPassword: jest.fn(),
  };

  const mockState = {
    username: "",
    password: "",
    loading: false,
    isPasswordVisible: false,
    focusedField: null,
    isBiometricAvailable: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useLoginLogic as jest.Mock).mockReturnValue({
      state: mockState,
      actions: mockActions,
    });
    mockUseThemeFn.mockImplementation(() => {
      return mockUseTheme();
    });
  });

  it("renders correctly", async () => {
    const { getByTestId, getByText } = await render(
      <LoginScreen {...createTestProps()} />,
    );

    expect(getByTestId("login-email-input")).toBeTruthy();
    expect(getByTestId("login-password-input")).toBeTruthy();
    expect(getByText("FFD Connect")).toBeTruthy();
  });

  it("calls setUsername when text changes", async () => {
    const { getByTestId } = await render(
      <LoginScreen {...createTestProps()} />,
    );
    await fireEvent.changeText(getByTestId("login-email-input"), "newuser");
    expect(mockActions.setUsername).toHaveBeenCalledWith("newuser");
  });

  it("calls setPassword when text changes", async () => {
    const { getByTestId } = await render(
      <LoginScreen {...createTestProps()} />,
    );
    await fireEvent.changeText(getByTestId("login-password-input"), "secret");
    expect(mockActions.setPassword).toHaveBeenCalledWith("secret");
  });

  it("calls onLogin when submit button pressed", async () => {
    const { getByTestId } = await render(
      <LoginScreen {...createTestProps()} />,
    );
    await fireEvent.press(getByTestId("login-submit-button"));
    expect(mockActions.onLogin).toHaveBeenCalled();
  });

  it("calls togglePasswordVisibility when eye icon pressed", async () => {
    const { getByTestId } = await render(
      <LoginScreen {...createTestProps()} />,
    );
    await fireEvent.press(getByTestId("login-password-toggle"));
    expect(mockActions.togglePasswordVisibility).toHaveBeenCalled();
  });

  it("shows biometric button when available", async () => {
    (useLoginLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, isBiometricAvailable: true },
      actions: mockActions,
    });

    const { getByTestId } = await render(
      <LoginScreen {...createTestProps()} />,
    );

    expect(getByTestId("login-biometric-button")).toBeTruthy();
  });

  it("calls onGuestLogin when guest button pressed", async () => {
    const { getByTestId } = await render(
      <LoginScreen {...createTestProps()} />,
    );
    await fireEvent.press(getByTestId("login-guest-button"));
    expect(mockActions.onGuestLogin).toHaveBeenCalled();
  });

  it("calls onForgotPassword when button pressed", async () => {
    const { getByTestId } = await render(
      <LoginScreen {...createTestProps()} />,
    );
    await fireEvent.press(getByTestId("login-forgot-password-button"));
    expect(mockActions.onForgotPassword).toHaveBeenCalled();
  });

  it("shows loading state on submit button", async () => {
    (useLoginLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, loading: true },
      actions: mockActions,
    });

    const { getByText } = await render(<LoginScreen {...createTestProps()} />);
    expect(getByText("Loading...")).toBeTruthy();
  });

  it("handles focus and blur on email input", async () => {
    const { getByTestId } = await render(
      <LoginScreen {...createTestProps()} />,
    );
    await fireEvent(getByTestId("login-email-input"), "focus");
    expect(mockActions.setFocusedField).toHaveBeenCalledWith("username");

    await fireEvent(getByTestId("login-email-input"), "blur");
    expect(mockActions.setFocusedField).toHaveBeenCalledWith(null);
  });

  it("handles focus and blur on password input", async () => {
    const { getByTestId } = await render(
      <LoginScreen {...createTestProps()} />,
    );
    await fireEvent(getByTestId("login-password-input"), "focus");
    expect(mockActions.setFocusedField).toHaveBeenCalledWith("password");

    await fireEvent(getByTestId("login-password-input"), "blur");
    expect(mockActions.setFocusedField).toHaveBeenCalledWith(null);
  });

  it("submits search on password input submit", async () => {
    const { getByTestId } = await render(
      <LoginScreen {...createTestProps()} />,
    );
    await fireEvent(getByTestId("login-password-input"), "submitEditing");
    expect(mockActions.onLogin).toHaveBeenCalled();
  });
});
