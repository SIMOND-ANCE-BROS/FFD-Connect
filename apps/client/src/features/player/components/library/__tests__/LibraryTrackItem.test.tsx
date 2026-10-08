import { render } from "@testing-library/react-native";
import React from "react";
import { Animated } from "react-native";
import type { AppTheme } from "../../../../../context/ThemeContext";
import type { TrackData } from "../../../context/PlayerContext";
import { LibraryTrackItem, pasoClashLabel } from "../LibraryTrackItem";

jest.mock("../../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { text: "#000", textSecondary: "#666", primary: "#007AFF" },
    isDark: false,
  }),
}));

jest.mock("../../../../../hooks/useIsOnline", () => ({
  useIsOnline: () => true,
}));

const theme = {
  surface: "#fff",
  text: "#000",
  textSecondary: "#666",
  secondary: "#f90",
  primary: "#007AFF",
} as unknown as AppTheme;

const track = (overrides: Partial<TrackData> = {}): TrackData => ({
  id: "t1",
  title: "España Cañí",
  artist: "Orchestre",
  url: "file:///t1.mp3",
  baseBpm: 60,
  style: "Paso Doble",
  ...overrides,
});

const renderItem = (item: TrackData) =>
  render(
    <LibraryTrackItem
      item={item}
      currentTheme={theme}
      isDark={false}
      isCurrent={false}
      isPlaying={false}
      bar1={new Animated.Value(0)}
      bar2={new Animated.Value(0)}
      bar3={new Animated.Value(0)}
      onPress={jest.fn()}
    />,
  );

describe("pasoClashLabel", () => {
  it("paso avec clashs saisis → nombre de clashs", () => {
    expect(pasoClashLabel("Paso Doble", [40, 80, 120])).toBe("3 clashs");
    expect(pasoClashLabel("Paso Doble", [40, 80])).toBe("2 clashs");
    expect(pasoClashLabel("Paso Doble", [40])).toBe("1 clash");
  });

  it("paso sans clash saisi → estimation", () => {
    expect(pasoClashLabel("Paso Doble", [])).toBe("Clashs estimés");
    expect(pasoClashLabel("Paso Doble", undefined)).toBe("Clashs estimés");
  });

  it("autre danse → pas de badge", () => {
    expect(pasoClashLabel("Rumba", [40])).toBeNull();
    expect(pasoClashLabel(undefined, undefined)).toBeNull();
  });
});

describe("LibraryTrackItem", () => {
  it("affiche le nombre de clashs d'un paso doble", async () => {
    const { getByTestId, getByText } = await renderItem(
      track({ clashTimecodes: [40, 80] }),
    );
    expect(getByTestId("library-track-t1-clashes")).toBeTruthy();
    expect(getByText("2 clashs")).toBeTruthy();
  });

  it("pas de badge clashs pour une autre danse", async () => {
    const { queryByTestId } = await renderItem(
      track({ style: "Rumba", clashTimecodes: [] }),
    );
    expect(queryByTestId("library-track-t1-clashes")).toBeNull();
  });
});
