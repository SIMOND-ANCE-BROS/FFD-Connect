import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import type { AppTheme } from "../../../../../context/ThemeContext";
import { announce } from "../../../../../utils/announce";
import type { LayoutItem } from "../../../hooks/useClubCompetitionEditorLogic";
import { DraggableLayoutItem } from "../DraggableLayoutItem";
import {
  layoutItemA11yLabel,
  layoutMoveAnnouncement,
  moveLayoutItem,
} from "../layoutItemA11y";

jest.mock("react-native-reanimated", () =>
  require("../../../../../__tests__/mocks/mockReanimated"),
);
jest.mock("react-native-gesture-handler", () =>
  require("../../../../../__tests__/mocks/mockGestureHandler"),
);
jest.mock("../../../../../components/AppText");
jest.mock("../../../../../utils/announce", () => ({ announce: jest.fn() }));

const theme = {
  surface: "#fff",
  text: "#111",
  textSecondary: "#666",
  primary: "#004481",
  secondary: "#0088ce",
  accent: "#e30613",
  border: "#ddd",
} as unknown as AppTheme;

const table: LayoutItem = {
  id: "t1",
  type: "TABLE",
  label: "Table 1",
  capacity: 8,
  x: 30,
  y: 20,
  width: 10,
  height: 10,
  lockedSeats: [0, 1],
};

describe("layoutItemA11y (#22)", () => {
  it("moves by one step and clamps to the canvas", () => {
    expect(moveLayoutItem(table, "up")).toEqual({ x: 30, y: 15 });
    expect(moveLayoutItem(table, "down")).toEqual({ x: 30, y: 25 });
    expect(moveLayoutItem(table, "left")).toEqual({ x: 25, y: 20 });
    expect(moveLayoutItem(table, "right")).toEqual({ x: 35, y: 20 });
    expect(moveLayoutItem({ ...table, x: 2 }, "left")).toEqual({
      x: 0,
      y: 20,
    });
    expect(moveLayoutItem({ ...table, x: 90 }, "right")).toEqual({
      x: 90,
      y: 20,
    });
  });

  it("reads a block as one sentence", () => {
    expect(layoutItemA11yLabel(table)).toBe(
      "Table, Table 1, 8 places, 2 non disponibles, à 30 % de la gauche, 20 % du haut",
    );
    expect(
      layoutItemA11yLabel({
        ...table,
        type: "GRADIN",
        label: "Tribune",
        rows: 3,
        cols: 4,
        lockedSeats: [],
      }),
    ).toBe(
      "Gradin, Tribune, 3 rangs de 4 places, 12 places, à 30 % de la gauche, 20 % du haut",
    );
    expect(
      layoutItemA11yLabel({ ...table, type: "OTHER", capacity: 0 }),
    ).toMatch(/^Élément, Table 1, aucune place,/);
  });

  it("announces the new position, or the edge", () => {
    expect(layoutMoveAnnouncement(table, { x: 35, y: 20 })).toBe(
      "Table 1 déplacé à 35 % de la gauche, 20 % du haut",
    );
    expect(layoutMoveAnnouncement(table, { x: 30, y: 20 })).toBe(
      "Table 1 est déjà au bord du plan",
    );
  });
});

describe("DraggableLayoutItem — screen reader (#22)", () => {
  const onPositionChange = jest.fn();
  const onBlockPress = jest.fn();
  const onQuickEdit = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  const renderItem = (item: LayoutItem = table) =>
    render(
      <DraggableLayoutItem
        item={item}
        canvasWidth={300}
        canvasHeight={300}
        theme={theme}
        isSelected={false}
        zoomScale={1}
        onPositionChange={onPositionChange}
        onBlockPress={onBlockPress}
        onQuickEdit={onQuickEdit}
      />,
    );

  const action = (actionName: string) =>
    fireEvent(
      screen.getByRole("button", { name: /^Table, Table 1/ }),
      "accessibilityAction",
      { nativeEvent: { actionName } },
    );

  it("is one named button with move / edit actions", async () => {
    await renderItem();
    const block = screen.getByRole("button", {
      name: layoutItemA11yLabel(table),
    });
    expect(block.props.accessibilityActions).toEqual(
      expect.arrayContaining([
        { name: "activate" },
        { name: "edit", label: "Modifier" },
        { name: "move-up", label: "Déplacer vers le haut" },
        { name: "move-right", label: "Déplacer vers la droite" },
      ]),
    );
  });

  it("moves the block by one step and announces it", async () => {
    await renderItem();
    await action("move-right");
    expect(onPositionChange).toHaveBeenCalledWith("t1", 35, 20);
    expect(announce).toHaveBeenCalledWith(
      "Table 1 déplacé à 35 % de la gauche, 20 % du haut",
    );
  });

  it("does not move past the edge, and says so", async () => {
    await renderItem({ ...table, y: 0 });
    await action("move-up");
    expect(onPositionChange).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith("Table 1 est déjà au bord du plan");
  });

  it("opens the details on activate and the editor on « Modifier »", async () => {
    await renderItem();
    await action("activate");
    expect(onBlockPress).toHaveBeenCalledWith(table);
    await action("edit");
    expect(onQuickEdit).toHaveBeenCalledWith(table);
  });
});
