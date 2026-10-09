import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import type { Gesture } from "react-native-gesture-handler";
import type { SharedValue } from "react-native-reanimated";
import { withTiming } from "react-native-reanimated";
import { getStackLayout, STACKED_CARD_PEEK, StackedCard } from "../StackedCard";

jest.mock("react-native-reanimated", () =>
  require("../../__tests__/mocks/mockReanimated"),
);
jest.mock("react-native-gesture-handler", () =>
  require("../../__tests__/mocks/mockGestureHandler"),
);

describe("getStackLayout", () => {
  it("puts the card behind one peek above the front card, at the same size", () => {
    const layout = getStackLayout(2, 0, [320, 300]);

    // FFD (index 0) in front, WDSF (index 1) peeking above it.
    expect(layout.offsets).toEqual([STACKED_CARD_PEEK, 0]);
    expect(layout.height).toBe(STACKED_CARD_PEEK + 320);
  });

  it("swaps the slots when the other card comes forward", () => {
    expect(getStackLayout(2, 1, [320, 300]).offsets).toEqual([
      0,
      STACKED_CARD_PEEK,
    ]);
  });

  it("keeps the list order of the cards behind", () => {
    expect(getStackLayout(3, 1, []).offsets).toEqual([
      0,
      2 * STACKED_CARD_PEEK,
      STACKED_CARD_PEEK,
    ]);
  });

  it("clips a taller card behind so it never shows under the front card", () => {
    const layout = getStackLayout(2, 0, [200, 400]);

    // Front bottom = peek + 200: the WDSF card behind is cut there.
    expect(layout.clipHeights).toEqual([undefined, STACKED_CARD_PEEK + 200]);
    expect(layout.height).toBe(STACKED_CARD_PEEK + 200);
  });

  it("does not clip before the front card is measured", () => {
    const layout = getStackLayout(2, 0, [undefined, 300]);

    expect(layout.clipHeights).toEqual([undefined, undefined]);
    expect(layout.height).toBe(300);
  });

  it("sizes a lone card to its own height", () => {
    expect(getStackLayout(1, 0, [280])).toEqual({
      offsets: [0],
      clipHeights: [undefined],
      height: 280,
    });
  });
});

describe("StackedCard", () => {
  const pullY = { value: 0 } as SharedValue<number>;
  const pullGesture = {} as ReturnType<typeof Gesture.Pan>;

  const renderCard = (
    props: Partial<React.ComponentProps<typeof StackedCard>>,
  ) =>
    render(
      <StackedCard
        index={1}
        isActive={false}
        offset={0}
        pullY={pullY}
        pullGesture={pullGesture}
        isPullable={false}
        onPress={jest.fn()}
        backCardLabel="Licence WDSF"
        testID="stacked"
        {...props}
      >
        <Text>card content</Text>
      </StackedCard>,
    );

  beforeEach(() => jest.clearAllMocks());

  it("makes a card behind a labelled button whose content is hidden", async () => {
    const onPress = jest.fn();
    const { getByLabelText, getByTestId } = await renderCard({ onPress });

    const button = getByLabelText("Licence WDSF");
    expect(button.props.accessibilityRole).toBe("button");
    const content = getByTestId("stacked-content", {
      includeHiddenElements: true,
    });
    expect(content.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(content.props.pointerEvents).toBe("none");

    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalled();
  });

  it("leaves the front card's own controls reachable", async () => {
    const { queryByLabelText, getByTestId } = await renderCard({
      isActive: true,
    });

    expect(queryByLabelText("Licence WDSF")).toBeNull();
    const content = getByTestId("stacked-content", {
      includeHiddenElements: true,
    });
    expect(content.props.pointerEvents).not.toBe("none");
    expect(content.props.accessibilityElementsHidden).toBe(false);
  });

  it("clips a card behind to its visible height", async () => {
    const { getByTestId } = await renderCard({ clipHeight: 120 });

    const content = getByTestId("stacked-content", {
      includeHiddenElements: true,
    });
    expect(content.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ maxHeight: 120 })]),
    );
  });

  it("animates to its new slot, respecting the OS reduce motion setting", async () => {
    const view = await renderCard({ offset: 0 });
    await view.rerender(
      <StackedCard
        index={1}
        isActive
        offset={STACKED_CARD_PEEK}
        pullY={pullY}
        pullGesture={pullGesture}
        isPullable={false}
        onPress={jest.fn()}
      >
        <Text>card content</Text>
      </StackedCard>,
    );

    expect(withTiming).toHaveBeenLastCalledWith(
      STACKED_CARD_PEEK,
      expect.objectContaining({ duration: 350, reduceMotion: "system" }),
    );
  });

  it("reports its full height to size the stack", async () => {
    const onHeightChange = jest.fn();
    const { getByTestId } = await renderCard({ onHeightChange });

    await fireEvent(getByTestId("stacked"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 335, height: 312 } },
    });
    expect(onHeightChange).toHaveBeenCalledWith(1, 312);
  });
});
