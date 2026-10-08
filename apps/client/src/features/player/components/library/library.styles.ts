import { StyleSheet } from "react-native";

export const libraryStyles = StyleSheet.create({
  // Screen layout
  container: {
    flex: 1,
  },
  header: {
    padding: 20,
    paddingBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerActionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },
  headerTitleSmall: {
    marginLeft: 10,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
  },

  // Search
  searchContainer: {
    paddingHorizontal: 20,
    marginBottom: 15,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 15,
    height: 45,
  },
  searchBarBorder: {
    borderWidth: 1,
    borderColor: "#EEEEEE",
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
    height: "100%",
  },

  // Tabs
  tabsContainer: {
    paddingHorizontal: 20,
    marginBottom: 15,
  },

  // Track list
  trackList: {
    paddingBottom: 100,
  },
  loadingMore: {
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  // Grid list
  gridList: {
    paddingHorizontal: 15,
    paddingBottom: 100,
  },
  gridListContent: {
    paddingBottom: 100,
  },
  columnWrapper: {
    justifyContent: "space-between",
    marginBottom: 15,
    paddingHorizontal: 15,
  },

  // Track item
  trackItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 12,
  },
  // Hors ligne sans copie locale : visible mais clairement non jouable (#416)
  trackItemUnavailable: {
    opacity: 0.35,
  },
  imageContainer: {
    width: 48,
    height: 48,
    borderRadius: 8,
    overflow: "hidden",
    marginRight: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  artwork: {
    width: "100%",
    height: "100%",
  },
  artworkPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  trackInfo: {
    flex: 1,
    marginRight: 8,
  },
  trackTitle: {
    marginBottom: 2,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  styleBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
  },
  styleText: {
    fontSize: 10,
    textTransform: "uppercase",
  },
  rightActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  bpmBadge: {
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    minWidth: 44,
  },
  bpmLabel: {
    fontSize: 8,
    textTransform: "uppercase",
  },

  // Playing indicator
  playingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  playingIndicator: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
  },
  playingBar: {
    width: 4,
    borderRadius: 2,
  },
  currentTrackHighlight: {
    borderLeftWidth: 3,
  },

  // Grid item
  gridItem: {
    width: "48%",
    borderRadius: 16,
    padding: 15,
    alignItems: "center",
  },
  gridItemBackground: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  gridIcon: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#000",
  },
  gridContent: {
    alignItems: "center",
  },

  // Empty state
  emptyContainer: {
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIconWrapper: {
    marginBottom: 12,
  },
  emptyTitle: {
    marginBottom: 8,
  },

  // Dark/light variants
  imageContainerDark: {
    backgroundColor: "#1E293B",
  },
  imageContainerLight: {
    backgroundColor: "#F1F5F9",
  },
  styleBadgeDark: {
    backgroundColor: "#1E293B",
  },
  styleBadgeLight: {
    backgroundColor: "#F1F5F9",
  },
  bpmBadgeDark: {
    backgroundColor: "#1E293B",
  },
  bpmBadgeLight: {
    backgroundColor: "#F1F5F9",
  },
  gridItemDark: {
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  gridItemLight: {
    backgroundColor: "#FFFFFF",
  },
  headerActionButtonDark: {
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  headerActionButtonLight: {
    backgroundColor: "#F5F5F5",
  },
  searchBarDark: {
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  searchBarLight: {
    backgroundColor: "#FFFFFF",
  },
  filterSectionLabel: {
    marginTop: 16,
    marginBottom: 10,
  },
  filterGroupLabel: {
    marginTop: 4,
    marginBottom: 8,
    opacity: 0.8,
  },
  filterChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  },
  filterMpmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  filterMpmInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
  },
});
