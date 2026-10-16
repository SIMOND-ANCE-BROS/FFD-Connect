import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { AppTheme } from "../../../../../context/ThemeContext";
import { TrackData } from "../../../context/PlayerContext";
import { TrackActionsSheet } from "../TrackActionsSheet";
import { preloadReactNative } from "../../../../../__tests__/mocks/preloadReactNative";

// Screen-reader contract of the track actions sheet (RGAA, issue #22).

jest.mock("../../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { text: "#111", textSecondary: "#666" },
    isDark: false,
  }),
}));

preloadReactNative("Modal");

const theme = {
  surface: "#fff",
  text: "#111",
  textSecondary: "#666",
  border: "#eee",
  danger: "#d00",
} as unknown as AppTheme;

const track = {
  id: "t1",
  url: "https://cdn/t1.mp3",
  title: "Libertango",
  artist: "Piazzolla",
  baseBpm: 120,
} as TrackData;

describe("TrackActionsSheet accessibility", () => {
  const handlers = () => ({
    onPlayNext: jest.fn(),
    onAddToQueue: jest.fn(),
    onExtraAction: jest.fn(),
    onBlacklist: jest.fn(),
    onClose: jest.fn(),
  });

  it("titles the sheet with the track and names every action", async () => {
    const h = handlers();
    const { getByRole } = await render(
      <TrackActionsSheet
        visible
        track={track}
        currentTheme={theme}
        extraAction="report"
        {...h}
      />,
    );

    expect(getByRole("header", { name: "Libertango" })).toBeTruthy();
    await fireEvent.press(getByRole("button", { name: "Lire ensuite" }));
    await fireEvent.press(getByRole("button", { name: "Ajouter à la file" }));
    await fireEvent.press(
      getByRole("button", { name: "Proposer une correction" }),
    );
    await fireEvent.press(
      getByRole("button", { name: "Blacklister le titre" }),
    );
    expect(h.onPlayNext).toHaveBeenCalledWith(track);
    expect(h.onAddToQueue).toHaveBeenCalledWith(track);
    expect(h.onExtraAction).toHaveBeenCalledWith(track);
    expect(h.onBlacklist).toHaveBeenCalledWith(track);
  });

  it("closes from the backdrop button or the escape gesture", async () => {
    const h = handlers();
    const { getByRole, getByTestId } = await render(
      <TrackActionsSheet
        visible
        track={track}
        currentTheme={theme}
        extraAction={null}
        {...h}
      />,
    );

    await fireEvent.press(getByRole("button", { name: "Fermer" }));
    await fireEvent(
      getByTestId("track-actions-sheet"),
      "onAccessibilityEscape",
    );
    expect(h.onClose).toHaveBeenCalledTimes(2);
  });
});
