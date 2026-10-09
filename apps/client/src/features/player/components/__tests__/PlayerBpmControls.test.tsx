import { act, fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { AppTheme } from "../../../../context/ThemeContext";
import { BPM_DRAG_THROTTLE_MS, PlayerBpmControls } from "../PlayerBpmControls";

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { text: "#000", textSecondary: "#666", primary: "#00f" },
    isDark: false,
  }),
}));

const currentTheme = {
  background: "#fff",
  surface: "#fff",
  text: "#000",
  textSecondary: "#666",
  border: "#ddd",
  primary: "#00f",
} as unknown as AppTheme;

const renderControls = async (
  overrides: Partial<React.ComponentProps<typeof PlayerBpmControls>> = {},
) => {
  const changeBpm = jest.fn().mockResolvedValue(undefined);
  const utils = await render(
    <PlayerBpmControls
      currentTheme={currentTheme}
      isDark={false}
      bpm={30}
      bpmDiff={0}
      minMpm={25}
      maxMpm={35}
      changeBpm={changeBpm}
      resetBpm={jest.fn().mockResolvedValue(undefined)}
      locked={false}
      onToggleLock={jest.fn()}
      {...overrides}
    />,
  );
  return { ...utils, changeBpm };
};

describe("PlayerBpmControls slider", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("throttles rate changes while dragging and commits on release", async () => {
    const { getByTestId, getByText, changeBpm } = await renderControls();
    const slider = getByTestId("audio-player-bpm-slider");

    await fireEvent(slider, "valueChange", 30.1);
    await fireEvent(slider, "valueChange", 30.2);
    await fireEvent(slider, "valueChange", 30.3);

    // First tick applied immediately, the rest coalesced.
    expect(changeBpm).toHaveBeenCalledTimes(1);
    expect(changeBpm).toHaveBeenLastCalledWith(30.1);
    // The display follows the finger, not the throttled store value.
    expect(getByText("30.3")).toBeTruthy();

    await act(() => {
      jest.advanceTimersByTime(BPM_DRAG_THROTTLE_MS);
    });
    expect(changeBpm).toHaveBeenCalledTimes(2);
    expect(changeBpm).toHaveBeenLastCalledWith(30.3);

    await fireEvent(slider, "valueChange", 31);
    await fireEvent(slider, "slidingComplete", 31.4);
    await act(() => {
      jest.advanceTimersByTime(BPM_DRAG_THROTTLE_MS * 2);
    });
    // The pending throttled update is dropped; the release value wins.
    expect(changeBpm).toHaveBeenLastCalledWith(31.4);
    expect(changeBpm).toHaveBeenCalledTimes(3);
  });

  it("remounts the slider on a range change and drops the in-flight drag", async () => {
    const { getByTestId, getByText, queryByText, changeBpm, rerender } =
      await renderControls();
    const slider = getByTestId("audio-player-bpm-slider");

    await fireEvent(slider, "valueChange", 30.1);
    await fireEvent(slider, "valueChange", 33);
    expect(changeBpm).toHaveBeenCalledTimes(1);

    // Track change: new range, new tempo (e.g. Paso -> Rumba).
    await rerender(
      <PlayerBpmControls
        currentTheme={currentTheme}
        isDark={false}
        bpm={18}
        bpmDiff={-5}
        minMpm={11.5}
        maxMpm={34.5}
        changeBpm={changeBpm}
        resetBpm={jest.fn().mockResolvedValue(undefined)}
        locked
        onToggleLock={jest.fn()}
      />,
    );
    await act(() => {
      jest.advanceTimersByTime(BPM_DRAG_THROTTLE_MS * 2);
    });

    const next = getByTestId("audio-player-bpm-slider");
    expect(next).not.toBe(slider);
    expect(next.props.value).toBe(18);
    expect(next.props.minimumValue).toBe(11.5);
    expect(next.props.maximumValue).toBe(34.5);
    expect(getByText("18.0")).toBeTruthy();
    expect(queryByText("33.0")).toBeNull();
    // The pending throttled drag value is never applied to the new track.
    expect(changeBpm).toHaveBeenCalledTimes(1);
  });

  it("ignores the slider when the tempo is locked", async () => {
    const { getByTestId, changeBpm } = await renderControls({ locked: true });
    const slider = getByTestId("audio-player-bpm-slider");

    await fireEvent(slider, "valueChange", 32);
    await fireEvent(slider, "slidingComplete", 32);

    expect(changeBpm).not.toHaveBeenCalled();
  });
});
