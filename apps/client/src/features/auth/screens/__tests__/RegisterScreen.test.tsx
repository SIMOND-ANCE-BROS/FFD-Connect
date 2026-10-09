import { render } from "@testing-library/react-native";
import React from "react";
import { BETA_NOTICES } from "../../../../constants/betaNotices";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { useRegisterLogic } from "../../hooks/useRegisterLogic";
import { RegisterScreen } from "../RegisterScreen";

jest.mock("../../hooks/useRegisterLogic");

const mockUseThemeFn = jest.fn(() =>
  (
    require("../../../../__tests__/mocks/mockTheme") as typeof import("../../../../__tests__/mocks/mockTheme")
  ).mockUseTheme(),
);
jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => mockUseThemeFn(),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("../../../../components/AppText");
jest.mock("../../../../components/AppButton");

jest.mock("../../../../components/AnimatedComponents", () => ({
  FadeInView: ({ children }: { children: React.ReactNode }) => children,
}));

describe("RegisterScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useRegisterLogic as jest.Mock).mockReturnValue({
      state: {
        email: "",
        password: "",
        confirmPassword: "",
        licenseNumber: "",
        lastName: "",
        firstName: "",
        loading: false,
        isPasswordVisible: false,
        focusedField: null,
        cguAccepted: false,
      },
      actions: {
        setEmail: jest.fn(),
        setPassword: jest.fn(),
        setConfirmPassword: jest.fn(),
        setLicenseNumber: jest.fn(),
        setLastName: jest.fn(),
        setFirstName: jest.fn(),
        togglePasswordVisibility: jest.fn(),
        setFocusedField: jest.fn(),
        toggleCguAccepted: jest.fn(),
        onRegister: jest.fn().mockResolvedValue(undefined),
        onGoToLogin: jest.fn(),
      },
    });
  });

  it("shows the beta independence notice above the form", async () => {
    const { getByTestId, getByText } = await render(
      <RegisterScreen {...createMockScreenProps("Register", undefined)} />,
    );

    expect(getByTestId("register-beta-notice")).toBeTruthy();
    expect(getByText(BETA_NOTICES.register.message)).toBeTruthy();
    expect(getByTestId("register-license-input")).toBeTruthy();
  });
});
