import { StyleSheet } from "react-native";

export const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
};

export const audioPlayerStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  headerButton: {
    padding: 10,
  },
  playlistNameContainer: {
    alignItems: "center",
  },
  playlistLabel: {
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "space-around",
    paddingBottom: 40,
  },
  albumArtContainer: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
    overflow: "hidden",
  },
  albumArtSmall: {
    height: 120,
    width: 120,
    aspectRatio: 1,
    marginBottom: 10,
    marginTop: 10,
    alignSelf: "center",
  },
  artworkImage: {
    width: "100%",
    height: "100%",
  },
  artworkPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  sideControl: {
    padding: 8,
    borderRadius: 20,
    width: 44,
    alignItems: "center",
  },
  controlDark: {
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  controlLight: {
    backgroundColor: "#F5F5F5",
  },
  controlActiveDark: {
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  controlActiveLight: {
    backgroundColor: "#E0E0E0",
  },
  bpmPanel: {
    marginTop: 20,
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    width: "100%",
  },
  bpmDisplayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  tempoLabel: {
    letterSpacing: 2,
  },
  tempoLockButton: {
    padding: 4,
  },
  rowBaseline: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  bpmValueSmall: {
    fontSize: 24,
    fontWeight: "bold",
  },
  bpmDiff: {
    fontSize: 12,
    marginLeft: 8,
    fontWeight: "bold",
  },
  speedSliderSmall: {
    width: "100%",
    height: 40,
  },
  speedMarkersSmall: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  resetButtonSmall: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  markerText: {
    fontSize: 12,
  },
  trackInfoContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  trackTextContainer: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 10,
  },
  textCenter: {
    textAlign: "center",
  },
  progressContainer: {
    width: "100%",
    marginBottom: 10,
  },
  // Bouton admin d'édition des appels paso doble (#paso-clashes)
  playerActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 4,
  },
  clashEditButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  progressBar: {
    width: "100%",
    height: 40,
  },
  timeInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -10,
  },
  tabular: {
    fontVariant: ["tabular-nums"],
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  controlButton: {
    padding: 10,
    alignItems: "center",
  },
  dotIndicator: {
    height: 4,
    width: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 4,
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  repeatBadge: {
    position: "absolute",
    top: 5,
    right: 5,
  },
  repeatOneText: {
    fontSize: 8,
  },
  queueOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  queueContainer: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: "70%",
  },
  queueHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  queueTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  queueItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  queueItemInfo: {
    flex: 1,
    marginRight: 12,
  },
  queueItemTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  queueItemArtist: {
    fontSize: 12,
    marginTop: 2,
  },
  queueActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  queueEmpty: {
    paddingVertical: 24,
    alignItems: "center",
  },
  queueList: {
    flexShrink: 1,
  },
  queueHint: {
    marginTop: -8,
    marginBottom: 8,
  },
  queueHandle: {
    paddingVertical: 8,
    paddingRight: 10,
  },
  queueItemDragging: {
    opacity: 0.7,
  },
  queueIconButton: {
    padding: 6,
  },
  loadingText: {
    marginTop: 10,
  },
  padding20: {
    padding: 20,
  },
  errorTitle: {
    marginBottom: 10,
  },
  marginBottom20: {
    marginBottom: 20,
  },
  retryButton: {
    padding: 10,
    borderRadius: 8,
  },
  backgroundFill: {
    flex: 1,
  },
  surfaceBackground: {
    width: "100%",
  },
  albumArtDark: {
    backgroundColor: "#1E293B",
  },
  albumArtLight: {
    backgroundColor: "#F1F5F9",
  },
  bpmPanelDark: {
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  bpmPanelLight: {
    backgroundColor: "#F8F9FA",
  },
  marginLeft4: {
    marginLeft: 4,
  },
  bold: {
    fontWeight: "bold",
  },
});
