import { StyleSheet } from "react-native";

// ── Constants ────────────────────────────────────────────────────────
export const PISTE_WIDTH_PCT = 34;
export const PISTE_HEIGHT_PCT = 42;
export const PISTE_LEFT_PCT = (100 - PISTE_WIDTH_PCT) / 2;
export const PISTE_TOP_PCT = (100 - PISTE_HEIGHT_PCT) / 2;

// ── Styles ───────────────────────────────────────────────────────────
export const styles = StyleSheet.create({
  // ── Wrapper / palette ──────────────────────────────────────────────
  wrapper: {
    marginBottom: 8,
  },
  palette: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  },
  paletteLabel: {
    marginRight: 4,
  },
  paletteChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  paletteChipLabel: {
    marginLeft: 6,
  },

  // ── Canvas ─────────────────────────────────────────────────────────
  canvas: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
  },
  canvasInner: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  },
  piste: {
    position: "absolute",
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: "dashed",
    justifyContent: "center",
    alignItems: "center",
  },
  pisteLabel: {
    fontSize: 11,
  },

  // ── Draggable item ─────────────────────────────────────────────────
  draggableItem: {
    position: "absolute",
    borderRadius: 8,
    borderWidth: 1,
    padding: 4,
    overflow: "hidden",
  },
  draggableItemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
    paddingHorizontal: 2,
  },
  draggableItemLabel: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  placesContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    minHeight: 20,
  },
  placesGridFlex: {
    flex: 1,
    alignSelf: "stretch",
    flexDirection: "column",
    gap: 1,
  },
  placesRowFlex: {
    flex: 1,
    flexDirection: "row",
    gap: 1,
    minHeight: 4,
  },
  seatFlex: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 20,
    borderRadius: 3,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  placesRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    flexWrap: "wrap",
  },
  placesColumn: {
    flexDirection: "column",
  },
  seat: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  canvasText: {
    fontSize: 10,
    textAlign: "center",
  },
  canvasSubtext: {
    fontSize: 9,
    marginTop: 2,
  },
  lockedBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  lockCount: {
    fontSize: 9,
    marginLeft: 2,
  },

  // ── Popup / modal ──────────────────────────────────────────────────
  popupBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  popupBox: {
    width: "100%",
    maxWidth: 340,
    maxHeight: "80%",
    borderRadius: 16,
    padding: 20,
  },
  popupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  popupActions: {
    gap: 10,
    marginBottom: 16,
  },
  popupButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  popupClose: {
    marginTop: 8,
  },
  popupPivotLabel: {
    marginLeft: 8,
  },
  popupSeatsSection: {
    marginBottom: 16,
  },
  popupSeatsScroll: {
    maxHeight: 200,
  },
  popupSeatsContent: {
    paddingVertical: 8,
  },
  popupGrid: {
    gap: 8,
  },
  popupSeatsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  popupSeat: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  popupHintText: {
    marginBottom: 8,
  },
  popupHintText2: {
    marginBottom: 4,
  },
  popupRowLabel: {
    width: 18,
    textAlign: "center" as const,
  },
  seatLabel: {
    fontSize: 11,
  },
});
