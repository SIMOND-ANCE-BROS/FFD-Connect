import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { View } from "react-native";
import { ThemeProvider } from "../../context/ThemeContext";
import {
  AuthProvider,
  AuthRepository,
} from "../../features/auth/context/AuthContext";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";
import { theme } from "../../theme";
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

  // Disabled fills carry a readable label (issue #22): never white on slate200.
  it.each(["primary", "secondary", "danger"] as const)(
    "uses the disabled token pair for a disabled %s button",
    async (variant) => {
      const { getByTestId, getByText } = await renderWithTheme(
        <AppButton
          title="Off"
          onPress={jest.fn()}
          variant={variant}
          disabled
        />,
      );
      const buttonStyle = StyleSheet.flatten(
        getByTestId(`button-${variant}`).props.style,
      ) as ViewStyle;
      const labelStyle = StyleSheet.flatten(
        getByText("Off").props.style,
      ) as TextStyle;
      expect(buttonStyle.backgroundColor).toBe(theme.light.disabledFill);
      expect(labelStyle.color).toBe(theme.light.onDisabled);
    },
  );

  // The in-app theme choice wins over the OS scheme: a dark preference on a
  // light phone must not keep the light outline label (ffdBlue, ~2:1 on dark).
  it("follows the in-app dark preference, not the OS scheme", async () => {
    (mockAuth.getAuthConfig as jest.Mock).mockResolvedValueOnce({
      isLoggedIn: false,
      role: "LICENSEE",
      appTheme: "dark",
      animationsEnabled: true,
    });
    const { getByText } = await renderWithTheme(
      <AppButton title="Contour" onPress={jest.fn()} variant="outline" />,
    );
    await waitFor(() => {
      const labelStyle = StyleSheet.flatten(
        getByText("Contour").props.style,
      ) as TextStyle;
      expect(labelStyle.color).toBe(theme.dark.primary);
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

  it("forwards its ref to the pressable, for focus restore (#22)", async () => {
    const ref = React.createRef<View>();
    const { getByRole } = await renderWithTheme(
      <AppButton ref={ref} title="Générer" onPress={jest.fn()} />,
    );
    expect(getByRole("button", { name: "Générer" })).toBeTruthy();
    expect(ref.current).not.toBeNull();
  });
});
