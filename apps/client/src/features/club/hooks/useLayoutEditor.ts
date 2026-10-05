import { useState } from "react";
import { Alert } from "react-native";
import type {
  LayoutItem,
  LayoutOrientation,
} from "./useClubCompetitionEditorLogic.types";

interface UseLayoutEditorParams {
  initialLayoutItems?: LayoutItem[];
}

export const useLayoutEditor = ({
  initialLayoutItems,
}: UseLayoutEditorParams) => {
  // --- LAYOUT STATE ---
  const [layoutItems, setLayoutItems] = useState<LayoutItem[]>(
    (initialLayoutItems ?? []).map((item: LayoutItem) => ({
      ...item,
      lockedSeats: item.lockedSeats ?? [],
      orientation: item.orientation ?? "horizontal",
    })),
  );
  const [showLayoutModal, setShowLayoutModal] = useState(false);
  const [editingLayoutItem, setEditingLayoutItem] = useState<LayoutItem | null>(
    null,
  );

  // Layout Form
  const [newLayoutType, setNewLayoutType] = useState<
    "TABLE" | "GRADIN" | "OTHER"
  >("TABLE");
  const [newLayoutLabel, setNewLayoutLabel] = useState("");
  const [newLayoutCapacity, setNewLayoutCapacity] = useState("8");
  const [newLayoutRows, setNewLayoutRows] = useState("4");
  const [newLayoutCols, setNewLayoutCols] = useState("2");
  const [newLayoutX, setNewLayoutX] = useState(50);
  const [newLayoutY, setNewLayoutY] = useState(50);
  const [newLayoutWidth, setNewLayoutWidth] = useState(15);
  const [newLayoutHeight, setNewLayoutHeight] = useState(10);
  const [newLayoutRotation, setNewLayoutRotation] = useState("0");

  // --- HELPERS ---
  /** Default position for new items: left side, stacked vertically (piste au centre) */
  const getDefaultLayoutPosition = (): { x: number; y: number } => {
    if (layoutItems.length === 0) return { x: 5, y: 25 };
    const leftItems = layoutItems.filter((it) => it.x < 35);
    const count = leftItems.length;
    return { x: 5, y: 15 + count * 22 };
  };

  // --- ACTIONS ---
  const openLayoutModal = (
    item?: LayoutItem,
    presetType?: "TABLE" | "GRADIN" | "OTHER",
  ) => {
    if (item) {
      setEditingLayoutItem(item);
      setNewLayoutType(item.type);
      setNewLayoutLabel(item.label);
      setNewLayoutCapacity(item.capacity.toString());
      setNewLayoutRows(item.rows?.toString() ?? "4");
      setNewLayoutCols(item.cols?.toString() ?? "2");
      setNewLayoutX(item.x);
      setNewLayoutY(item.y);
      setNewLayoutWidth(item.width);
      setNewLayoutHeight(item.height);
      setNewLayoutRotation((item.rotationDeg ?? 0).toString());
    } else {
      setEditingLayoutItem(null);
      const type = presetType ?? "TABLE";
      setNewLayoutType(type);
      setNewLayoutLabel("");
      setNewLayoutCapacity(type === "GRADIN" ? "8" : "8");
      setNewLayoutRows("4");
      setNewLayoutCols("2");
      const def = getDefaultLayoutPosition();
      setNewLayoutX(def.x);
      setNewLayoutY(def.y);
      setNewLayoutWidth(type === "GRADIN" ? 18 : 12);
      setNewLayoutHeight(type === "GRADIN" ? 25 : 10);
      setNewLayoutRotation("0");
    }
    setShowLayoutModal(true);
  };

  const updateLayoutItemPosition = (id: string, x: number, y: number) => {
    setLayoutItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, x, y } : item)),
    );
  };

  const toggleLayoutItemSeatLock = (id: string, seatIndex: number) => {
    setLayoutItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const locked = item.lockedSeats ?? [];
        const idx = locked.indexOf(seatIndex);
        const nextLocked =
          idx === -1
            ? [...locked, seatIndex].sort((a, b) => a - b)
            : locked.filter((_, i) => i !== idx);
        return { ...item, lockedSeats: nextLocked };
      }),
    );
  };

  /** Change l'orientation (horizontal/vertical) et adapte largeur/hauteur. */
  const cycleLayoutItemOrientation = (id: string) => {
    setLayoutItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const nextOrientation =
          (item.orientation ?? "horizontal") === "horizontal"
            ? "vertical"
            : "horizontal";
        return {
          ...item,
          orientation: nextOrientation,
          width: item.height,
          height: item.width,
        };
      }),
    );
  };

  const addLayoutItem = () => {
    if (!newLayoutLabel) {
      Alert.alert("Erreur", "Veuillez donner un nom à cet élément");
      return;
    }

    if (editingLayoutItem) {
      const capacity =
        newLayoutType === "GRADIN"
          ? (parseInt(newLayoutRows, 10) || 0) *
            (parseInt(newLayoutCols, 10) || 0)
          : parseInt(newLayoutCapacity, 10) || 0;
      const rotation = parseInt(newLayoutRotation, 10) || 0;
      setLayoutItems(
        layoutItems.map((it) => {
          if (it.id !== editingLayoutItem.id) return it;
          const locked = it.lockedSeats ?? [];
          const validLocked = locked.filter((i) => i < capacity);
          return {
            ...it,
            type: newLayoutType,
            label: newLayoutLabel,
            capacity,
            x: newLayoutX,
            y: newLayoutY,
            width: newLayoutWidth,
            height: newLayoutHeight,
            rows:
              newLayoutType === "GRADIN"
                ? parseInt(newLayoutRows, 10) || 0
                : undefined,
            cols:
              newLayoutType === "GRADIN"
                ? parseInt(newLayoutCols, 10) || 0
                : undefined,
            lockedSeats: validLocked,
            rotationDeg: rotation,
          };
        }),
      );
    } else {
      const rows =
        newLayoutType === "GRADIN" ? parseInt(newLayoutRows, 10) || 0 : 0;
      const cols =
        newLayoutType === "GRADIN" ? parseInt(newLayoutCols, 10) || 0 : 0;
      const capacity =
        newLayoutType === "GRADIN"
          ? rows * cols
          : parseInt(newLayoutCapacity, 10) || 0;
      const orientation: LayoutOrientation = "horizontal";
      const rotation = parseInt(newLayoutRotation, 10) || 0;
      let width: number;
      let height: number;
      if (newLayoutType === "GRADIN" && rows > 0 && cols > 0) {
        const kw = 3;
        const kh = 5;
        const base = 6;
        width = Math.min(32, base + cols * kw);
        height = Math.min(42, base + rows * kh);
      } else if (newLayoutType === "TABLE") {
        const n = Math.max(1, capacity);
        width = Math.min(38, 8 + n * 2.2);
        height = 14;
      } else {
        width = newLayoutWidth;
        height = newLayoutHeight;
      }
      const newItem: LayoutItem = {
        id: Math.random().toString(36).substr(2, 9),
        type: newLayoutType,
        label: newLayoutLabel,
        capacity,
        x: newLayoutX,
        y: newLayoutY,
        width,
        height,
        rows: newLayoutType === "GRADIN" ? rows : undefined,
        cols: newLayoutType === "GRADIN" ? cols : undefined,
        lockedSeats: [],
        orientation,
        rotationDeg: rotation,
      };
      setLayoutItems([...layoutItems, newItem]);
    }
    setShowLayoutModal(false);
  };

  const removeLayoutItem = (id: string) => {
    setLayoutItems(layoutItems.filter((item) => item.id !== id));
  };

  const duplicateLayoutItem = (id: string) => {
    setLayoutItems((prev) => {
      const source = prev.find((item) => item.id === id);
      if (!source) return prev;

      const labelMatch = source.label.match(/^(.*?)(?:\s+(\d+))$/);
      let nextLabel: string;
      if (labelMatch) {
        const base = labelMatch[1].trim();
        const num = parseInt(labelMatch[2] || "1", 10) || 1;
        nextLabel = `${base} ${num + 1}`;
      } else {
        nextLabel = `${source.label} (2)`;
      }

      const maxX = Math.max(0, 100 - source.width);
      const maxY = Math.max(0, 100 - source.height);
      const offsetX = Math.min(maxX, source.x + 5);
      const offsetY = Math.min(maxY, source.y + 5);

      const duplicated: LayoutItem = {
        ...source,
        id: Math.random().toString(36).substr(2, 9),
        label: nextLabel,
        x: offsetX,
        y: offsetY,
        lockedSeats: [...(source.lockedSeats ?? [])],
      };

      return [...prev, duplicated];
    });
  };

  return {
    layoutItems,
    showLayoutModal,
    setShowLayoutModal,
    newLayoutType,
    setNewLayoutType,
    newLayoutLabel,
    setNewLayoutLabel,
    newLayoutCapacity,
    setNewLayoutCapacity,
    newLayoutRows,
    setNewLayoutRows,
    newLayoutCols,
    setNewLayoutCols,
    newLayoutX,
    setNewLayoutX,
    newLayoutY,
    setNewLayoutY,
    newLayoutWidth,
    setNewLayoutWidth,
    newLayoutHeight,
    setNewLayoutHeight,
    newLayoutRotation,
    setNewLayoutRotation,
    openLayoutModal,
    updateLayoutItemPosition,
    toggleLayoutItemSeatLock,
    cycleLayoutItemOrientation,
    editingLayoutItem,
    addLayoutItem,
    removeLayoutItem,
    duplicateLayoutItem,
  };
};
