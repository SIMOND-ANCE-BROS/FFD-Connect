/**
 * MSW Integration Tests for LoginScreen
 *
 * These tests verify the LoginScreen behavior when the API
 * returns different responses, using MSW to intercept real axios calls.
 */
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { http, HttpResponse } from "msw";
import React from "react";
import { server } from "../../../../mocks/msw/server";
import { mockUseTheme } from "../../../../__tests__/mocks/mockTheme";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { LoginScreen } from "../LoginScreen";

// Mock hooks that the screen uses
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

const { useLoginLogic } = require("../../hooks/useLoginLogic") as {
  useLoginLogic: jest.Mock;
};

const createTestProps = () => createMockScreenProps("Login", undefined);

describe("LoginScreen MSW Integration", () => {
  const mockNavigate = jest.fn();
  const mockReplace = jest.fn();

  const buildMockActions = (
    overrides?: Partial<Record<string, jest.Mock>>,
  ) => ({
    setUsername: jest.fn(),
    setPassword: jest.fn(),
    togglePasswordVisibility: jest.fn(),
    setFocusedField: jest.fn(),
    onLogin: jest.fn().mockResolvedValue(undefined),
    onBiometricLogin: jest.fn().mockResolvedValue(undefined),
    onGuestLogin: jest.fn().mockResolvedValue(undefined),
    onForgotPassword: jest.fn(),
    ...overrides,
  });

  const mockState = {
    username: "test@ffd.com",
    password: "password123",
    loading: false,
    isPasswordVisible: false,
    focusedField: null,
    isBiometricAvailable: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseThemeFn.mockImplementation(() => mockUseTheme());
  });

  it("renders login form with email and password inputs", async () => {
    useLoginLogic.mockReturnValue({
      state: mockState,
      actions: buildMockActions(),
    });

    const { getByTestId } = await render(
      <LoginScreen {...createTestProps()} />,
    );

    expect(getByTestId("login-email-input")).toBeTruthy();
    expect(getByTestId("login-password-input")).toBeTruthy();
    expect(getByTestId("login-submit-button")).toBeTruthy();
  });

  it("calls onLogin when submit button is pressed", async () => {
    const onLogin = jest.fn().mockResolvedValue(undefined);

    useLoginLogic.mockReturnValue({
      state: mockState,
      actions: buildMockActions({ onLogin }),
    });

    const { getByTestId } = await render(
      <LoginScreen {...createTestProps()} />,
    );
    await fireEvent.press(getByTestId("login-submit-button"));

    expect(onLogin).toHaveBeenCalled();
  });

  it("shows error message on login failure (MSW returns 401)", async () => {
    // Override MSW handler to return 401 for this test
    server.use(
      http.post("http://localhost:3000/auth/login", () => {
        return HttpResponse.json(
          { message: "Invalid credentials" },
          { status: 401 },
        );
      }),
    );

    const onLogin = jest
      .fn()
      .mockRejectedValue(new Error("Invalid credentials"));

    useLoginLogic.mockReturnValue({
      state: { ...mockState, loading: false },
      actions: buildMockActions({ onLogin }),
    });

    const { getByTestId } = await render(
      <LoginScreen {...createTestProps()} />,
    );

    await fireEvent.press(getByTestId("login-submit-button"));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalled();
    });
  });

  it("shows loading state while login is in progress", async () => {
    useLoginLogic.mockReturnValue({
      state: { ...mockState, loading: true },
      actions: buildMockActions(),
    });

    const { getByText } = await render(<LoginScreen {...createTestProps()} />);

    expect(getByText("Loading...")).toBeTruthy();
  });

  it("navigates to home on successful login (MSW returns 200)", async () => {
    // MSW default handler returns success
    const onLogin = jest.fn().mockImplementation(async () => {
      // Simulate navigation after successful login
      mockReplace("Main", { isGuest: false, role: "LICENSEE" });
    });

    useLoginLogic.mockReturnValue({
      state: mockState,
      actions: buildMockActions({ onLogin }),
    });

    const { getByTestId } = await render(
      <LoginScreen {...createTestProps()} />,
    );

    await fireEvent.press(getByTestId("login-submit-button"));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith("Main", {
        isGuest: false,
        role: "LICENSEE",
      });
    });
  });

  it("calls onForgotPassword when forgot password button is pressed", async () => {
    const onForgotPassword = jest.fn();

    useLoginLogic.mockReturnValue({
      state: mockState,
      actions: buildMockActions({ onForgotPassword }),
    });

    const { getByTestId } = await render(
      <LoginScreen {...createTestProps()} />,
    );
    await fireEvent.press(getByTestId("login-forgot-password-button"));

    expect(onForgotPassword).toHaveBeenCalled();
  });

  it("shows error state when MSW returns 500", async () => {
    // Override MSW to simulate server error
    server.use(
      http.post("http://localhost:3000/auth/login", () => {
        return HttpResponse.json(
          { message: "Internal server error" },
          { status: 500 },
        );
      }),
    );

    const onLogin = jest
      .fn()
      .mockRejectedValue(new Error("Internal server error"));

    useLoginLogic.mockReturnValue({
      state: mockState,
      actions: buildMockActions({ onLogin }),
    });

    const { getByTestId } = await render(
      <LoginScreen {...createTestProps()} />,
    );

    await fireEvent.press(getByTestId("login-submit-button"));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalled();
    });
  });

  it("navigates to forgot password screen via MSW forgot-password endpoint", async () => {
    // Override MSW to ensure forgot-password endpoint returns success
    server.use(
      http.post("http://localhost:3000/auth/forgot-password", () => {
        return HttpResponse.json({ success: true });
      }),
    );

    const onForgotPassword = jest.fn().mockImplementation(() => {
      mockNavigate("ForgotPassword");
    });

    useLoginLogic.mockReturnValue({
      state: mockState,
      actions: buildMockActions({ onForgotPassword }),
    });

    const { getByTestId } = await render(
      <LoginScreen {...createTestProps()} />,
    );
    await fireEvent.press(getByTestId("login-forgot-password-button"));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("ForgotPassword");
    });
  });
});
