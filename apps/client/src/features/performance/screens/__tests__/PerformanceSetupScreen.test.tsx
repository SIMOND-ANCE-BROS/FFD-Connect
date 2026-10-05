import { useNavigation } from "@react-navigation/native";
import { fireEvent, render } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import { Alert } from "react-native";
import { useTheme } from "../../../../context/ThemeContext";
import { usePerformanceEngine } from "../../hooks/usePerformanceEngine";
import { PerformanceSetupScreen } from "../PerformanceSetupScreen";

jest.mock("../../hooks/usePerformanceEngine", () => ({
  usePerformanceEngine: jest.fn(),
}));
jest.mock("../../../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useTheme: jest.fn(),
}));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: jest.fn(),
}));

describe("PerformanceSetupScreen", () => {
  const mockTheme = {
    background: "#fff",
    surface: "#f2f2f2",
    text: "#111",
    textSecondary: "#666",
    primary: "#3b82f6",
    border: "#e5e7eb",
  };

  const navigation = { goBack: jest.fn(), navigate: jest.fn() };

  const defaultConfig = {
    mode: "Round",
    category: "Latin",
    numberOfHeats: 2,
    duration: 30,
    pauseDuration: 10,
    pasoClashes: 2,
    selectedDances: ["Samba"],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    (useTheme as jest.Mock).mockReturnValue({ theme: mockTheme });
    (useNavigation as jest.Mock).mockReturnValue(navigation);
    (usePerformanceEngine as jest.Mock).mockReturnValue({
      config: defaultConfig,
      setConfig: jest.fn(),
      startPerformance: jest.fn(),
    });
  });

  it("shows validation error when round heats < 2", async () => {
    (usePerformanceEngine as jest.Mock).mockReturnValue({
      config: { ...defaultConfig, numberOfHeats: 1 },
      setConfig: jest.fn(),
      startPerformance: jest.fn(),
    });

    const { getByTestId } = await render(<PerformanceSetupScreen />);

    await fireEvent.press(getByTestId("performance-setup-start-button"));
    expect(Alert.alert).toHaveBeenCalledWith(
      "Configuration invalide",
      "Le mode Passage nécessite au moins 2 passages.",
    );
  });

  it("switches mode and updates configuration", async () => {
    const setConfig = jest.fn();
    (usePerformanceEngine as jest.Mock).mockReturnValue({
      config: defaultConfig,
      setConfig,
      startPerformance: jest.fn(),
    });

    const { getByTestId } = await render(<PerformanceSetupScreen />);

    // Switch to Finale
    await fireEvent.press(getByTestId("performance-setup-mode-tab-Final"));
    expect(setConfig).toHaveBeenCalled();
  });

  it("switches category and updates dances", async () => {
    const setConfig = jest.fn();
    (usePerformanceEngine as jest.Mock).mockReturnValue({
      config: defaultConfig,
      setConfig,
      startPerformance: jest.fn(),
    });

    const { getByTestId } = await render(<PerformanceSetupScreen />);

    await fireEvent.press(
      getByTestId("performance-setup-category-tab-Standard"),
    );
    expect(setConfig).toHaveBeenCalled();
  });

  it("updates numeric inputs", async () => {
    const setConfig = jest.fn();
    (usePerformanceEngine as jest.Mock).mockReturnValue({
      config: defaultConfig,
      setConfig,
      startPerformance: jest.fn(),
    });

    const { getByTestId } = await render(<PerformanceSetupScreen />);

    await fireEvent.changeText(
      getByTestId("performance-setup-duration-input"),
      "45",
    );
    expect(setConfig).toHaveBeenCalled();
  });

  it("toggles dance selection and deselection", async () => {
    const setConfig = jest.fn();
    (usePerformanceEngine as jest.Mock).mockReturnValue({
      config: defaultConfig,
      setConfig,
      startPerformance: jest.fn(),
    });

    const { getByTestId } = await render(<PerformanceSetupScreen />);

    // Select (was already in defaultConfig, so this should toggle it OFF)
    await fireEvent.press(getByTestId("performance-setup-dance-samba"));
    expect(setConfig).toHaveBeenCalled();
    const updateFn = setConfig.mock.calls[0][0];
    const newConfig = updateFn({ selectedDances: ["Samba"] });
    expect(newConfig.selectedDances).not.toContain("Samba");
  });

  it("updates Paso clashes", async () => {
    const setConfig = jest.fn();
    (usePerformanceEngine as jest.Mock).mockReturnValue({
      config: defaultConfig,
      setConfig,
      startPerformance: jest.fn(),
    });

    const { getByTestId } = await render(<PerformanceSetupScreen />);

    await fireEvent.press(getByTestId("performance-setup-paso-tab-3"));
    expect(setConfig).toHaveBeenCalled();
  });

  it("validates heats input on blur", async () => {
    const setConfig = jest.fn();
    (usePerformanceEngine as jest.Mock).mockReturnValue({
      config: { ...defaultConfig, numberOfHeats: 1 },
      setConfig,
      startPerformance: jest.fn(),
    });

    const { getByTestId } = await render(<PerformanceSetupScreen />);

    await fireEvent(getByTestId("performance-setup-heats-input"), "endEditing");
    expect(setConfig).toHaveBeenCalled();
    const updateFn = setConfig.mock.calls[0][0];
    const newConfig = updateFn({ numberOfHeats: 1 });
    expect(newConfig.numberOfHeats).toBe(2);
  });

  it("starts performance and navigates", async () => {
    const startPerformance = jest.fn().mockResolvedValue(true);
    (usePerformanceEngine as jest.Mock).mockReturnValue({
      config: defaultConfig,
      setConfig: jest.fn(),
      startPerformance,
    });

    const { getByTestId } = await render(<PerformanceSetupScreen />);

    await fireEvent.press(getByTestId("performance-setup-start-button"));

    expect(startPerformance).toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith("PerformancePlayer");
  });

  it("navigates back", async () => {
    const { getByTestId } = await render(<PerformanceSetupScreen />);

    await fireEvent.press(getByTestId("back-button"));
    expect(navigation.goBack).toHaveBeenCalled();
  });
});
