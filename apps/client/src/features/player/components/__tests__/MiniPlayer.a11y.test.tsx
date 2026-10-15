import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { MiniPlayer } from "../MiniPlayer";

// Screen-reader contract of the mini player (RGAA, issue #22): the play
// button must be its own element (not swallowed by the open-player
// touchable) and swipe-to-close needs an accessible alternative.

const mockTogglePlayback = jest.fn().mockResolvedValue(undefined);
const mockResetPlayer = jest.fn().mockResolvedValue(undefined);
const mockNavigate = jest.fn();

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      background: "#fff",
      surface: "#fff",
      text: "#000",
      textSecondary: "#666",
      border: "#ddd",
      primary: "#00f",
    },
    isDark: false,
  }),
}));

jest.mock("../../context/PlayerContext", () => ({
  usePlayer: () => ({
    currentTrack: {
      id: "1",
      title: "Cha Cha Night",
      artist: "DJ Ice",
      artwork: null,
      style: "Cha-cha-cha",
    },
    isPlaying: true,
    togglePlayback: mockTogglePlayback,
    resetPlayer: mockResetPlayer,
  }),
}));

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock("react-native-track-player", () => ({
  useProgress: () => ({ position: 10, duration: 100 }),
}));

describe("MiniPlayer accessibility", () => {
  beforeEach(() => jest.clearAllMocks());

  it("exposes the open-player area and the play button as two buttons", async () => {
    const { getByRole } = await render(<MiniPlayer currentRouteName="Home" />);

    const open = getByRole("button", {
      name: "Lecteur, Cha Cha Night, Cha-cha-cha, DJ Ice",
    });
    expect(open.props.testID).toBe("mini-player-container");

    const pause = getByRole("button", { name: "Pause" });
    expect(pause.props.testID).toBe("mini-player-play-button");
    await fireEvent.press(pause);
    expect(mockTogglePlayback).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("offers a 'Fermer le lecteur' action instead of the swipe gesture", async () => {
    const { getByTestId } = await render(
      <MiniPlayer currentRouteName="Home" />,
    );
    const open = getByTestId("mini-player-container");
    expect(open.props.accessibilityActions).toEqual(
      expect.arrayContaining([{ name: "dismiss", label: "Fermer le lecteur" }]),
    );

    await fireEvent(open, "accessibilityAction", {
      nativeEvent: { actionName: "dismiss" },
    });
    expect(mockResetPlayer).toHaveBeenCalled();

    await fireEvent(open, "accessibilityAction", {
      nativeEvent: { actionName: "activate" },
    });
    expect(mockNavigate).toHaveBeenCalledWith("AudioPlayer");
  });
});
