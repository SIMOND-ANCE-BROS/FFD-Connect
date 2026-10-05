import { act, fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { useTheme, ThemeContextType } from "../../../../context/ThemeContext";
import { TimingList } from "../TimingList";

jest.mock("../../services/ReportService", () => ({
  ReportService: {
    sendReport: jest.fn(),
  },
}));
jest.mock("../../../../context/ThemeContext");

const mockUseTheme = useTheme as jest.MockedFunction<typeof useTheme>;

describe("TimingList", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockUseTheme.mockReturnValue({
      theme: {
        background: "#fff",
        surface: "#f7f7f7",
        text: "#111",
        textSecondary: "#666",
        border: "#e0e0e0",
        primary: "#004481",
        danger: "#d32f2f",
      },
    } as unknown as ThemeContextType);
  });

  afterEach(async () => {
    await act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it("renders empty state when schedule is empty", async () => {
    const { getByText } = await render(
      <TimingList schedule={[]} myEventIds={[]} />,
    );

    expect(getByText("Timing indisponible")).toBeTruthy();
  });

  it("filters to my events when toggle is enabled", async () => {
    const schedule = [
      {
        id: "s1",
        title: "Round 1",
        startTime: new Date().toISOString(),
        type: "ROUND",
        eventId: "e1",
      },
      {
        id: "s2",
        title: "Round 2",
        startTime: new Date().toISOString(),
        type: "ROUND",
        eventId: "e2",
      },
    ];

    const { getByText, queryByText, getByRole } = await render(
      <TimingList schedule={schedule as never} myEventIds={["e1"]} />,
    );

    expect(getByText("Round 1")).toBeTruthy();
    expect(getByText("Round 2")).toBeTruthy();

    await fireEvent(getByRole("switch"), "valueChange", true);

    expect(getByText("Round 1")).toBeTruthy();
    expect(queryByText("Round 2")).toBeNull();
  });
});
