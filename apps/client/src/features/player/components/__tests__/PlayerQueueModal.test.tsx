import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { announce } from "../../../../utils/announce";
import { AppTheme } from "../../../../context/ThemeContext";
import { TrackData } from "../../types";
import { PlayerQueueModal } from "../PlayerQueueModal";
import { preloadReactNative } from "../../../../__tests__/mocks/preloadReactNative";

// The global mock only renders the list header; this one renders the rows and
// lets the test trigger a drop.
const mockDrag = jest.fn();
let mockOnDragEnd:
  | ((p: { data: TrackData[]; from: number; to: number }) => void)
  | undefined;
jest.mock("react-native-draggable-flatlist", () => {
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: ({
      data,
      renderItem,
      onDragEnd,
    }: {
      data: TrackData[];
      renderItem: (p: {
        item: TrackData;
        getIndex: () => number;
        drag: () => void;
        isActive: boolean;
      }) => React.ReactNode;
      onDragEnd: typeof mockOnDragEnd;
    }) => {
      mockOnDragEnd = onDragEnd;
      return (
        <View>
          {data.map((item, index) => (
            <View key={item.id}>
              {renderItem({
                item,
                getIndex: () => index,
                drag: mockDrag,
                isActive: false,
              })}
            </View>
          ))}
        </View>
      );
    },
    ScaleDecorator: ({ children }: { children: React.ReactNode }) => children,
  };
});

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { text: "#111", textSecondary: "#666" },
    isDark: false,
  }),
}));

const theme = {
  surface: "#fff",
  text: "#111",
  textSecondary: "#666",
  primary: "#00f",
  border: "#eee",
} as unknown as AppTheme;

const t = (id: string): TrackData => ({
  id,
  url: `https://cdn/${id}.mp3`,
  title: `Title ${id}`,
  artist: `Artist ${id}`,
  baseBpm: 120,
});

jest.mock("../../../../utils/announce", () => ({ announce: jest.fn() }));

// One-off react-native module loading, out of the first test's budget
// (flaky under load otherwise, #546).
preloadReactNative("Modal");

describe("PlayerQueueModal", () => {
  const props = () => ({
    currentTheme: theme,
    isDark: false,
    isQueueVisible: true,
    tracks: [t("a"), t("b"), t("c")],
    currentTrackId: "b",
    closeQueue: jest.fn(),
    playQueueTrack: jest.fn().mockResolvedValue(undefined),
    removeQueueTrack: jest.fn(),
    moveQueueTrack: jest.fn(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockOnDragEnd = undefined;
  });

  it("lists the queue and flags the current track", async () => {
    const p = props();
    const { getByText, getByLabelText } = await render(
      <PlayerQueueModal {...p} />,
    );

    expect(getByText("Title a")).toBeTruthy();
    expect(getByText("En lecture")).toBeTruthy();
    expect(getByText("Maintenez un titre pour le déplacer.")).toBeTruthy();
    expect(
      getByLabelText("Title b, Artist b, en lecture, 2 sur 3"),
    ).toBeTruthy();
  });

  it("plays a track on tap and removes one with the trash button", async () => {
    const p = props();
    const { getByTestId } = await render(<PlayerQueueModal {...p} />);

    await fireEvent.press(getByTestId("queue-track-c"));
    expect(p.playQueueTrack).toHaveBeenCalledWith("c");

    await fireEvent.press(getByTestId("queue-remove-a"));
    expect(p.removeQueueTrack).toHaveBeenCalledWith("a");
  });

  it("starts a drag from the handle or a long-press", async () => {
    const { getByTestId } = await render(<PlayerQueueModal {...props()} />);

    // The handle is a drag gesture only: hidden from screen readers.
    await fireEvent(
      getByTestId("queue-drag-a", { includeHiddenElements: true }),
      "onPressIn",
    );
    await fireEvent(getByTestId("queue-track-a"), "onLongPress");

    expect(mockDrag).toHaveBeenCalledTimes(2);
  });

  it("forwards the drop indexes to moveQueueTrack", async () => {
    const p = props();
    await render(<PlayerQueueModal {...p} />);

    mockOnDragEnd?.({ data: [t("c"), t("a"), t("b")], from: 2, to: 0 });

    expect(p.moveQueueTrack).toHaveBeenCalledWith(2, 0);
  });

  it("offers screen-reader move actions within bounds", async () => {
    const p = props();
    const { getByTestId } = await render(<PlayerQueueModal {...p} />);

    const first = getByTestId("queue-track-a");
    const middle = getByTestId("queue-track-b");
    const last = getByTestId("queue-track-c");
    const names = (el: typeof first) =>
      (el.props.accessibilityActions as { name: string }[]).map((a) => a.name);
    expect(names(first)).toEqual(["moveDown", "remove"]);
    expect(names(middle)).toEqual(["moveUp", "moveDown", "remove"]);
    expect(names(last)).toEqual(["moveUp", "remove"]);

    await fireEvent(middle, "onAccessibilityAction", {
      nativeEvent: { actionName: "moveUp" },
    });
    await fireEvent(middle, "onAccessibilityAction", {
      nativeEvent: { actionName: "moveDown" },
    });
    expect(p.moveQueueTrack).toHaveBeenNthCalledWith(1, 1, 0);
    expect(p.moveQueueTrack).toHaveBeenNthCalledWith(2, 1, 2);
    expect(announce).toHaveBeenCalledWith("Title b, position 1 sur 3");
  });

  it("removes a track through the screen-reader action (nested button unreachable)", async () => {
    const p = props();
    const { getByTestId } = await render(<PlayerQueueModal {...p} />);

    await fireEvent(getByTestId("queue-track-a"), "onAccessibilityAction", {
      nativeEvent: { actionName: "remove" },
    });
    expect(p.removeQueueTrack).toHaveBeenCalledWith("a");
    expect(announce).toHaveBeenCalledWith("Title a retiré de la file");
  });

  it("exposes the title as a heading", async () => {
    const { getByRole } = await render(<PlayerQueueModal {...props()} />);
    expect(getByRole("header", { name: "File d'attente" })).toBeTruthy();
  });

  it("shows the empty state without a drag hint", async () => {
    const { getByText, queryByText } = await render(
      <PlayerQueueModal {...props()} tracks={[]} />,
    );

    expect(getByText("Aucun titre dans la file")).toBeTruthy();
    expect(queryByText("Maintenez un titre pour le déplacer.")).toBeNull();
  });

  it("closes from the close button", async () => {
    const p = props();
    const { getByLabelText } = await render(<PlayerQueueModal {...p} />);

    await fireEvent.press(getByLabelText("Fermer", { exact: true }));
    expect(p.closeQueue).toHaveBeenCalled();
  });
});
