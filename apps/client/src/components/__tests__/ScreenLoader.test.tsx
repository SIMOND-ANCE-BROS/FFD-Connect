import { render } from "@testing-library/react-native";
import React from "react";
import { ScreenLoader } from "../ScreenLoader";
import { useWakeStore } from "../../stores/wake.store";

jest.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({ theme: { primary: "#0077cc" }, isDark: false }),
}));

afterEach(() => {
  useWakeStore.setState({ waking: false, visible: false });
});

describe("ScreenLoader", () => {
  it("renders a single centered loader", async () => {
    const { getByTestId } = await render(<ScreenLoader testID="loader" />);
    expect(getByTestId("loader")).toBeTruthy();
  });

  it("is hidden while the blocking wake overlay is shown", async () => {
    useWakeStore.setState({ waking: true, visible: true });
    const { queryByTestId } = await render(<ScreenLoader testID="loader" />);
    expect(queryByTestId("loader")).toBeNull();
  });

  it("stays visible during a silent pre-warm (no overlay)", async () => {
    useWakeStore.setState({ waking: true, visible: false });
    const { getByTestId } = await render(<ScreenLoader testID="loader" />);
    expect(getByTestId("loader")).toBeTruthy();
  });
});
