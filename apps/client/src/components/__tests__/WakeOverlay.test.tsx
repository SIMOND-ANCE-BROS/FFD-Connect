import { render } from "@testing-library/react-native";
import React from "react";
import {
  WakeOverlay,
  WAKE_OVERLAY_ANNOUNCEMENT,
  WAKE_OVERLAY_SUBTITLE,
} from "../WakeOverlay";
import { useWakeStore } from "../../stores/wake.store";
import { announce } from "../../utils/announce";

jest.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      primary: "#0077cc",
      surface: "#ffffff",
      text: "#111111",
      textSecondary: "#555555",
    },
    isDark: false,
  }),
}));

jest.mock("../../utils/announce", () => ({ announce: jest.fn() }));

afterEach(() => {
  useWakeStore.setState({ waking: false, visible: false, elapsed: 0 });
  jest.clearAllMocks();
});

describe("WakeOverlay", () => {
  it("renders nothing outside a blocking wake", async () => {
    const { queryByText } = await render(<WakeOverlay />);
    expect(queryByText("Réveil du serveur…")).toBeNull();
    expect(announce).not.toHaveBeenCalled();
  });

  it("stays hidden during a silent pre-warm", async () => {
    useWakeStore.setState({ waking: true, visible: false });
    const { queryByText } = await render(<WakeOverlay />);
    expect(queryByText("Réveil du serveur…")).toBeNull();
  });

  it("announces about a minute of wait (measured cold start 30-60 s)", async () => {
    useWakeStore.setState({ waking: true, visible: true, elapsed: 12 });
    const { getByText, queryByText } = await render(<WakeOverlay />);
    expect(getByText("Réveil du serveur…")).toBeTruthy();
    expect(getByText(WAKE_OVERLAY_SUBTITLE)).toBeTruthy();
    expect(WAKE_OVERLAY_SUBTITLE).toContain("environ une minute");
    expect(queryByText(/90 secondes/)).toBeNull();
    expect(getByText("12s")).toBeTruthy();
    expect(announce).toHaveBeenCalledWith(WAKE_OVERLAY_ANNOUNCEMENT);
  });
});
