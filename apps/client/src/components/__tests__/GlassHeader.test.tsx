import { render } from "@testing-library/react-native";
import React from "react";
import { Animated, Text } from "react-native";
import { GlassHeader } from "../GlassHeader";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

jest.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { text: "#000", textSecondary: "#666", border: "#ccc" },
    isDark: false,
  }),
}));

const theme = {
  text: "#000",
  border: "#ccc",
} as never;

describe("GlassHeader", () => {
  it("affiche le titre et les slots gauche/droite", async () => {
    const scrollY = new Animated.Value(0);
    const { getByText, getByTestId } = await render(
      <GlassHeader
        theme={theme}
        isDark={false}
        title="Réglages"
        scrollY={scrollY}
        left={<Text testID="left-slot">L</Text>}
        right={<Text testID="right-slot">R</Text>}
      />,
    );

    expect(getByText("Réglages")).toBeTruthy();
    expect(getByTestId("left-slot")).toBeTruthy();
    expect(getByTestId("right-slot")).toBeTruthy();
    expect(getByTestId("glass-header")).toBeTruthy();
  });
});
