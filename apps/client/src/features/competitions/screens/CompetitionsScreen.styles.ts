import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  listHeader: {
    marginBottom: 8,
  },
  listHeaderTabs: {
    paddingHorizontal: 16,
  },
  tabWrapper: {
    marginBottom: 12,
  },
  cardRightColumn: {
    flexDirection: "column",
    alignItems: "flex-end",
  },
  badgeMargin: {
    marginTop: 4,
  },
  organizerBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: "flex-end",
  },
  organizerBadgeText: {
    fontSize: 11,
  },
  clubMembersRow: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.06)",
  },
  clubMembersText: {
    marginLeft: 0,
  },
  organizerCounterRow: {
    marginTop: 8,
    marginBottom: 4,
  },
  organizerCounterText: {
    fontSize: 13,
  },
  emptySubtitle: {
    marginTop: 8,
  },
  loadMoreButton: {
    marginTop: 16,
    alignSelf: "center",
  },
  // Scope Tabs (All / For Me)
  scopeTabsContainer: {
    flexDirection: "row",
    marginBottom: 16,
    backgroundColor: "rgba(118, 118, 128, 0.12)",
    borderRadius: 8,
    padding: 2,
  },
  scopeTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 6,
  },
  scopeTabActive: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  scopeTabText: {
    fontSize: 14,
    fontWeight: "600",
  },

  // Status Filters (Chips)
  filtersContainer: {
    flexDirection: "row",
    marginBottom: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "600",
  },

  // List
  listContent: {
    paddingVertical: 0,
    paddingBottom: 16,
    paddingHorizontal: 0,
  },
  fluidTabWrapper: {
    marginBottom: 12,
  },
  emptyContainer: {
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
  },

  // Card
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    marginHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    marginRight: 8,
    lineHeight: 22,
  },
  cardDateContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  cardDate: {
    fontSize: 14,
    marginLeft: 6,
    fontWeight: "500",
  },
  liveTimeRow: {
    marginTop: 4,
    marginBottom: 4,
  },
  deadlineContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    alignSelf: "flex-start",
  },
  deadlineText: {
    marginLeft: 4,
    fontSize: 12,
  },
  cardLocationContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardLocation: {
    fontSize: 14,
    marginLeft: 6,
  },
  distanceText: {
    fontSize: 12,
    marginLeft: 22,
    marginTop: 2,
  },

  // Status Badge
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: "hidden",
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  // Header actions (filter button + notification bell)
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
  // Filter sheet
  filterSectionLabel: {
    marginTop: 16,
    marginBottom: 10,
  },
  filterChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterNote: {
    marginTop: 6,
  },
  customInput: {
    marginTop: 10,
    height: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  dateRangeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
  },
  dateButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  dateClear: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  dateDone: {
    marginTop: 10,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  footerEmpty: {
    height: 40,
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
