import { fireEvent, render } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import { useTheme } from "../../../../context/ThemeContext";
import { OFFICIAL_DANCE_ORDER } from "../../../../stores/danceOrder.store";
import { DanceOrderEditor } from "../DanceOrderEditor";

interface ListProps {
  data: string[];
  renderItem: (p: object) => React.ReactNode;
  keyExtractor: (d: string) => string;
  scrollEnabled?: boolean;
  activationDistance?: number;
  onDragBegin?: (index: number) => void;
  onDragEnd?: (p: { data: string[]; from: number; to: number }) => void;
}

/** Props of every rendered draggable list, one entry per category. */
const mockListProps: ListProps[] = [];

jest.mock("react-native-draggable-flatlist", () => {
  const { Fragment } = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    ScaleDecorator: ({ children }: PropsWithChildren) => <>{children}</>,
    NestableDraggableFlatList: () => {
      throw new Error("the nestable list must not be used (broken autoscroll)");
    },
    default: (props: ListProps) => {
      mockListProps.push(props);
      return props.data.map((item, index) => (
        <Fragment key={props.keyExtractor(item)}>
          {props.renderItem({
            item,
            drag: jest.fn(),
            isActive: false,
            getIndex: () => index,
          })}
        </Fragment>
      ));
    },
  };
});
jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: jest.fn(),
}));

describe("DanceOrderEditor", () => {
  beforeEach(() => {
    mockListProps.length = 0;
    (useTheme as jest.Mock).mockReturnValue({
      theme: {
        surface: "#fff",
        text: "#111",
        textSecondary: "#666",
        primary: "#3b82f6",
        border: "#e5e7eb",
      },
    });
  });

  const setup = async () => {
    const onChange = jest.fn();
    const onDragActiveChange = jest.fn();
    const utils = await render(
      <DanceOrderEditor
        categories={["Latin"]}
        danceOrder={OFFICIAL_DANCE_ORDER}
        isOfficial
        onChange={onChange}
        onReset={jest.fn()}
        onDragActiveChange={onDragActiveChange}
      />,
    );
    return { ...utils, onChange, onDragActiveChange };
  };

  it("uses a non-scrolling draggable list (no nested auto-scroll)", async () => {
    await setup();
    const list = mockListProps[mockListProps.length - 1];
    expect(list.scrollEnabled).toBe(false);
    // A vertical swipe on a row must still be able to scroll the page.
    expect(list.activationDistance).toBeGreaterThan(0);
    expect(list.data).toEqual([...OFFICIAL_DANCE_ORDER.Latin]);
  });

  it("freezes the page scroll for the duration of a drag", async () => {
    const { onChange, onDragActiveChange } = await setup();
    const list = mockListProps[mockListProps.length - 1];

    list.onDragBegin?.(0);
    expect(onDragActiveChange).toHaveBeenLastCalledWith(true);

    const reordered = [...OFFICIAL_DANCE_ORDER.Latin].reverse();
    list.onDragEnd?.({ data: reordered, from: 0, to: 4 });
    expect(onDragActiveChange).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalledWith("Latin", reordered);
  });

  it("keeps the accessible up/down arrows", async () => {
    const { getByTestId, onChange } = await setup();
    await fireEvent.press(getByTestId("performance-dance-order-latin-jive-up"));
    const moved = onChange.mock.calls[0][1] as string[];
    expect(moved.indexOf("Jive")).toBe(
      OFFICIAL_DANCE_ORDER.Latin.indexOf("Jive") - 1,
    );
    expect(
      getByTestId("performance-dance-order-latin-jive-down"),
    ).toBeDisabled();
  });
});
