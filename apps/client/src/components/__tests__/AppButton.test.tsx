import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { ThemeProvider } from "../../context/ThemeContext";
import {
  AuthProvider,
  AuthRepository,
} from "../../features/auth/context/AuthContext";
import { AppButton } from "../AppButton";

const mockAuth = {
  getAuthConfig: jest.fn().mockResolvedValue({
    isLoggedIn: false,
    role: "LICENSEE",
    appTheme: "light",
    animationsEnabled: true,
  }),
  setAppTheme: jest.fn().mockResolvedValue(undefined),
  setAnimationsEnabled: jest.fn().mockResolvedValue(undefined),
} as unknown as AuthRepository;

const renderWithTheme = async (ui: React.ReactNode) =>
  await render(
    <AuthProvider implementation={mockAuth}>
      <ThemeProvider>{ui}</ThemeProvider>
    </AuthProvider>,
  );

describe("AppButton", () => {
  it("renders label and handles press", async () => {
    const onPress = jest.fn();

    const { getByText, getByTestId } = await renderWithTheme(
      <AppButton title="Valider" onPress={onPress} />,
    );

    expect(getByText("Valider")).toBeTruthy();
    await fireEvent.press(getByTestId("button-primary"));
    expect(onPress).toHaveBeenCalled();
  });

  it("hides label when loading", async () => {
    const { queryByText, getByTestId } = await renderWithTheme(
      <AppButton title="Envoyer" onPress={jest.fn()} loading />,
    );

    expect(getByTestId("button-primary")).toBeTruthy();
    expect(queryByText("Envoyer")).toBeNull();
  });

  describe("Variants", () => {
    it("renders secondary variant", async () => {
      const { getByTestId } = await renderWithTheme(
        <AppButton title="T" onPress={jest.fn()} variant="secondary" />,
      );
      expect(getByTestId("button-secondary")).toBeTruthy();
    });

    it("renders outline variant", async () => {
      const { getByTestId } = await renderWithTheme(
        <AppButton title="T" onPress={jest.fn()} variant="outline" />,
      );
      expect(getByTestId("button-outline")).toBeTruthy();
    });

    it("renders ghost variant", async () => {
      const { getByTestId } = await renderWithTheme(
        <AppButton title="T" onPress={jest.fn()} variant="ghost" />,
      );
      expect(getByTestId("button-ghost")).toBeTruthy();
    });

    it("renders danger variant", async () => {
      const { getByTestId } = await renderWithTheme(
        <AppButton title="T" onPress={jest.fn()} variant="danger" />,
      );
      expect(getByTestId("button-danger")).toBeTruthy();
    });

    it("renders disabled state", async () => {
      const { getByTestId } = await renderWithTheme(
        <AppButton title="T" onPress={jest.fn()} disabled />,
      );
      const button = getByTestId("button-primary");
      expect(button.props.accessibilityState.disabled).toBe(true);
    });
  });

  it("does not trigger on press when disabled", async () => {
    const mockPress = jest.fn();
    const { getByText } = await renderWithTheme(
      <AppButton title="Disabled" onPress={mockPress} disabled />,
    );
    await fireEvent.press(getByText("Disabled"));
    expect(mockPress).not.toHaveBeenCalled();
  });

  it("does not trigger on press when loading", async () => {
    const mockPress = jest.fn();
    const { getByTestId } = await renderWithTheme(
      <AppButton title="Loading" onPress={mockPress} loading />,
    );
    await fireEvent.press(getByTestId("button-loader"));
    expect(mockPress).not.toHaveBeenCalled();
  });
});
