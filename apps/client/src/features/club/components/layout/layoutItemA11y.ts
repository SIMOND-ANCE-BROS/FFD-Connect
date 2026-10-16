import { joinA11yLabel } from "../../../../utils/a11y";
import type { LayoutItem } from "../../hooks/useClubCompetitionEditorLogic";

/**
 * Screen-reader editing of the seat plan (#22). The canvas blocks only react
 * to drag / double-tap gestures, which VoiceOver and TalkBack swallow: each
 * block exposes « Déplacer vers le haut / bas / la gauche / la droite »
 * actions instead, moving it by a fixed step of the canvas.
 */

/** One keyboard / reader move, in percent of the canvas. */
export const LAYOUT_MOVE_STEP_PCT = 5;

export type LayoutMoveDirection = "up" | "down" | "left" | "right";

export const LAYOUT_MOVE_ACTIONS: ReadonlyArray<{
  name: `move-${LayoutMoveDirection}`;
  direction: LayoutMoveDirection;
  label: string;
}> = [
  { name: "move-up", direction: "up", label: "Déplacer vers le haut" },
  { name: "move-down", direction: "down", label: "Déplacer vers le bas" },
  { name: "move-left", direction: "left", label: "Déplacer vers la gauche" },
  { name: "move-right", direction: "right", label: "Déplacer vers la droite" },
];

const TYPE_LABELS: Record<LayoutItem["type"], string> = {
  TABLE: "Table",
  GRADIN: "Gradin",
  OTHER: "Élément",
};

/** Keeps the block inside the canvas (its top-left corner, in percent). */
export function clampLayoutPosition(
  item: Pick<LayoutItem, "width" | "height">,
  xPct: number,
  yPct: number,
): { x: number; y: number } {
  const maxX = Math.max(0, 100 - item.width);
  const maxY = Math.max(0, 100 - item.height);
  return {
    x: Math.max(0, Math.min(maxX, xPct)),
    y: Math.max(0, Math.min(maxY, yPct)),
  };
}

/** New position after one step in `direction`, clamped to the canvas. */
export function moveLayoutItem(
  item: Pick<LayoutItem, "x" | "y" | "width" | "height">,
  direction: LayoutMoveDirection,
  step: number = LAYOUT_MOVE_STEP_PCT,
): { x: number; y: number } {
  const dx = direction === "left" ? -step : direction === "right" ? step : 0;
  const dy = direction === "up" ? -step : direction === "down" ? step : 0;
  return clampLayoutPosition(item, item.x + dx, item.y + dy);
}

function seatCount(item: LayoutItem): number {
  return item.type === "GRADIN" && item.rows != null && item.cols != null
    ? item.rows * item.cols
    : item.capacity;
}

/** Spoken position: « à 30 % de la gauche, 20 % du haut ». */
export function spokenLayoutPosition(
  item: Pick<LayoutItem, "x" | "y">,
): string {
  return `à ${Math.round(item.x)} % de la gauche, ${Math.round(item.y)} % du haut`;
}

/** The block as one sentence: type, name, seats, locked seats, position. */
export function layoutItemA11yLabel(item: LayoutItem): string {
  const seats = seatCount(item);
  const locked = item.lockedSeats?.length ?? 0;
  return joinA11yLabel([
    TYPE_LABELS[item.type],
    item.label,
    item.type === "GRADIN" && item.rows != null && item.cols != null
      ? `${item.rows} rangs de ${item.cols} places`
      : null,
    seats > 0 ? `${seats} place${seats > 1 ? "s" : ""}` : "aucune place",
    locked > 0 ? `${locked} non disponible${locked > 1 ? "s" : ""}` : null,
    spokenLayoutPosition(item),
  ]);
}

/**
 * What the reader says after a move: the new position, or that the block is
 * already against that edge (nothing moved).
 */
export function layoutMoveAnnouncement(
  item: Pick<LayoutItem, "label" | "x" | "y">,
  next: { x: number; y: number },
): string {
  if (next.x === item.x && next.y === item.y) {
    return `${item.label} est déjà au bord du plan`;
  }
  return `${item.label} déplacé ${spokenLayoutPosition(next)}`;
}
