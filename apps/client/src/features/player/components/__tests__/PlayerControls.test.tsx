import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import type { AppTheme } from "../../../../context/ThemeContext";
import { PlayerRepeatMode } from "../../types";
import { PlayerControls, repeatModeLabel } from "../PlayerControls";

// Screen-reader contract of the player transport (RGAA, issue #22).

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { text: "#000", textSecondary: "#666", primary: "#004481" },
    isDark: false,
    animationsEnabled: false,
  }),
}));

const theme = {
  primary: "#0088CE",
  textSecondary: "#666666",
} as unknown as AppTheme;

const handlers = () => ({
  toggleShuffle: jest.fn(),
  handlePrev: jest.fn(),
  handleNext: jest.fn(),
  togglePlayback: jest.fn(),
  toggleRepeat: jest.fn(),
});

describe("PlayerControls accessibility", () => {
  it("names every transport button in French", async () => {
    const h = handlers();
    const { getByRole } = await render(
      <PlayerControls
        currentTheme={theme}
        isShuffle={false}
        isPlaying={false}
        repeatMode={PlayerRepeatMode.Off}
        {...h}
      />,
    );

    await fireEvent.press(getByRole("button", { name: "Morceau précédent" }));
    await fireEvent.press(getByRole("button", { name: "Lecture" }));
    await fireEvent.press(getByRole("button", { name: "Morceau suivant" }));
    await fireEvent.press(
      getByRole("button", { name: "Répétition désactivée" }),
    );
    expect(h.handlePrev).toHaveBeenCalled();
    expect(h.togglePlayback).toHaveBeenCalled();
    expect(h.handleNext).toHaveBeenCalled();
    expect(h.toggleRepeat).toHaveBeenCalled();
  });

  it("exposes shuffle as a switch with its state", async () => {
    const h = handlers();
    const { getByRole, rerender } = await render(
      <PlayerControls
        currentTheme={theme}
        isShuffle={false}
        isPlaying
        repeatMode={PlayerRepeatMode.Off}
        {...h}
      />,
    );
    expect(
      getByRole("switch", { name: "Lecture aléatoire", checked: false }),
    ).toBeTruthy();
    expect(getByRole("button", { name: "Pause" })).toBeTruthy();

    await rerender(
      <PlayerControls
        currentTheme={theme}
        isShuffle
        isPlaying
        repeatMode={PlayerRepeatMode.Track}
        {...h}
      />,
    );
    const shuffle = getByRole("switch", {
      name: "Lecture aléatoire",
      checked: true,
    });
    expect(shuffle.props.testID).toBe("audio-player-shuffle-button");
    expect(getByRole("button", { name: "Répéter le morceau" })).toBeTruthy();
  });

  it.each([
    [PlayerRepeatMode.Off, "Répétition désactivée"],
    [PlayerRepeatMode.Queue, "Répéter la file"],
    [PlayerRepeatMode.Track, "Répéter le morceau"],
  ])("speaks the repeat mode %p as %p", (mode, label) => {
    expect(repeatModeLabel(mode)).toBe(label);
  });
});
