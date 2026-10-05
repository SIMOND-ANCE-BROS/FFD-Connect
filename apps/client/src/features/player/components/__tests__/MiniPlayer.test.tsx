import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { MiniPlayer } from "../MiniPlayer";

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
  usePlayer: jest.fn(),
}));

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock("react-native-track-player", () => ({
  useProgress: () => ({ position: 10, duration: 100 }),
}));

const { usePlayer } = require("../../context/PlayerContext");

describe("MiniPlayer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePlayer.mockReturnValue({
      currentTrack: {
        id: "1",
        title: "Track Title",
        artist: "Artist",
        artwork: null,
        style: "Samba",
      },
      isPlaying: false,
      togglePlayback: mockTogglePlayback,
      resetPlayer: mockResetPlayer,
    });
  });

  it("renders current track info", async () => {
    const { getByText } = await render(<MiniPlayer currentRouteName="Home" />);

    expect(getByText("Track Title")).toBeTruthy();
    expect(getByText("Samba • Artist")).toBeTruthy();
  });

  it("renders artwork when available", async () => {
    usePlayer.mockReturnValue({
      currentTrack: {
        id: "1",
        title: "Track Title",
        artist: "Artist",
        artwork: "https://example.com/artwork.jpg",
        style: "Samba",
      },
      isPlaying: false,
      togglePlayback: mockTogglePlayback,
      resetPlayer: mockResetPlayer,
    });

    const { getByTestId } = await render(
      <MiniPlayer currentRouteName="Home" />,
    );
    // Artwork image should be rendered
    const image = getByTestId("mini-player-artwork");
    expect(image).toBeTruthy();
    expect(image.props.source).toEqual({
      uri: "https://example.com/artwork.jpg",
    });
  });

  it("renders without style prefix when style is missing", async () => {
    usePlayer.mockReturnValue({
      currentTrack: {
        id: "1",
        title: "Track Title",
        artist: "Artist",
        artwork: null,
        style: undefined,
      },
      isPlaying: false,
      togglePlayback: mockTogglePlayback,
      resetPlayer: mockResetPlayer,
    });

    const { getByText } = await render(<MiniPlayer currentRouteName="Home" />);
    expect(getByText("Artist")).toBeTruthy();
    expect(() => getByText("Samba • Artist")).toThrow();
  });

  it("calls togglePlayback when play button is pressed", async () => {
    const { getByTestId } = await render(
      <MiniPlayer currentRouteName="Home" />,
    );
    const playButton = getByTestId("mini-player-play-button");

    await fireEvent.press(playButton);
    expect(mockTogglePlayback).toHaveBeenCalledTimes(1);
  });

  it("shows pause icon when playing", async () => {
    usePlayer.mockReturnValue({
      currentTrack: {
        id: "1",
        title: "Track Title",
        artist: "Artist",
        artwork: null,
        style: "Samba",
      },
      isPlaying: true,
      togglePlayback: mockTogglePlayback,
      resetPlayer: mockResetPlayer,
    });

    const { getByTestId } = await render(
      <MiniPlayer currentRouteName="Home" />,
    );
    const pauseIcon = getByTestId("mini-player-pause-icon");
    expect(pauseIcon).toBeTruthy();
  });

  it("navigates to AudioPlayer when pressed", async () => {
    const { getByTestId } = await render(
      <MiniPlayer currentRouteName="Home" />,
    );
    const playerContainer = getByTestId("mini-player-container");

    await fireEvent.press(playerContainer);
    expect(mockNavigate).toHaveBeenCalledWith("AudioPlayer");
  });

  it("does not render when currentTrack is null", async () => {
    usePlayer.mockReturnValue({
      currentTrack: null,
      isPlaying: false,
      togglePlayback: mockTogglePlayback,
      resetPlayer: mockResetPlayer,
    });

    const { queryByText } = await render(
      <MiniPlayer currentRouteName="Home" />,
    );
    expect(queryByText("Track Title")).toBeNull();
  });

  it("does not render on Login screen", async () => {
    const { queryByText } = await render(
      <MiniPlayer currentRouteName="Login" />,
    );
    expect(queryByText("Track Title")).toBeNull();
  });
});
