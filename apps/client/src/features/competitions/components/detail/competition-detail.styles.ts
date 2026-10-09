import { StyleSheet } from "react-native";

/** Libellé court pour la raison de non-éligibilité (codes serveur ou message). */
export function getEligibilityReasonLabel(reason: string): string {
  const s = reason.trim();
  if (s === "GUEST") return "Connexion requise";
  if (s === "LOADING") return "Chargement…";
  if (s === "WRONG_CATEGORY") return "Catégorie non compatible";
  if (s === "WRONG_AGE_GROUP") return "Classe d'âge non compatible";
  if (s === "AGE_GROUP_REQUIRED") return "Classe d'âge non renseignée";
  if (s === "NOT_ALLOWED") return "Non autorisé pour cette épreuve";
  if (s.length > 60) return s.slice(0, 57) + "…";
  return s;
}

export const styles = StyleSheet.create({
  flexOne: {
    flex: 1,
  },
  mainContainer: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  headerButton: {
    padding: 12,
  },
  circleButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  fullWidth: {
    flex: 1,
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: "center",
    marginHorizontal: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
  },
  headerSubtitle: {
    fontSize: 12,
    textAlign: "center",
  },
  headerRightSpacer: {
    width: 40,
  },
  betaNotice: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  infoCard: {
    margin: 16,
    padding: 16,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.05,
    shadowRadius: 3.84,
    elevation: 2,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  iconSpacing: {
    marginRight: 12,
  },
  // Fills the remaining row width so long values (address, email) wrap inside
  // the card instead of overflowing past its right edge.
  infoContent: {
    flex: 1,
  },
  separator: {
    height: 1,
    backgroundColor: "rgba(0,0,0,0.05)",
    marginVertical: 4,
    marginLeft: 32,
  },
  tabContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  eventsList: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 12,
  },
  eventCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  eventCardBody: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eventInfo: {
    flex: 1,
    marginRight: 12,
  },
  eventDetails: {
    marginTop: 2,
  },
  eventActionsColumn: {
    flexDirection: "column",
    gap: 8,
    alignItems: "flex-end",
    minWidth: 100,
  },
  notEligibleBadge: {
    marginTop: 4,
    alignSelf: "flex-start",
  },
  notEligibleReason: {
    marginTop: 2,
  },
  /** Pour AppButton (outline/primary) : pas de bordure sur le wrapper, le bouton gère la sienne. */
  compactActionButtonFromApp: {
    height: 36,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 22,
    paddingHorizontal: 12,
    minWidth: 80,
  },
  pendingSection: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  smallButton: {
    minWidth: 72,
    paddingHorizontal: 10,
  },
  disabledEvent: {
    opacity: 0.6,
  },
  timingContainer: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  delayBadgeContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  delayBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  alignSelfStart: {
    alignSelf: "flex-start",
  },
  mapCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3.84,
    elevation: 2,
  },
  mapContainer: {
    height: 150,
    width: "100%",
  },
  mapImage: {
    width: "100%",
    height: "100%",
  },
  mapFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  mapFallbackTitle: {
    marginTop: 8,
  },
  navigationRow: {
    flexDirection: "row",
    padding: 12,
    gap: 8,
    justifyContent: "space-between",
  },
  mb8: { marginBottom: 8 },
  flex1: { flex: 1 },
  rowGap8: { flexDirection: "row" as const, gap: 8 },
  italicCenter: { fontStyle: "italic" as const, alignSelf: "center" as const },
});
