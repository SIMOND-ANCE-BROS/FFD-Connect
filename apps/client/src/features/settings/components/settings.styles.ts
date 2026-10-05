import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  logoutButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },
  actionButtonDark: {
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  actionButtonLight: {
    backgroundColor: "#F5F5F5",
  },
  content: {
    padding: 20,
  },
  profileSection: {
    alignItems: "center",
    marginBottom: 30,
    marginTop: 10,
  },
  avatarContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
    marginBottom: 10,
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 50,
  },
  avatarPlaceholder: {
    width: "100%",
    height: "100%",
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
  },
  editBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
  },
  changePhotoText: {
    fontSize: 16,
    fontWeight: "600",
  },
  sectionTitleContainer: {
    marginBottom: 10,
    paddingLeft: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  card: {
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  noPaddingBottom: {
    paddingBottom: 8,
  },
  borderTop: {
    borderTopWidth: 1,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  rowSubtext: {
    fontSize: 13,
    marginTop: 2,
  },
  // Libellé + sous-titre empilés à droite de l'icône. `flexShrink` est requis :
  // sans lui une description longue pousse l'interrupteur hors de l'écran.
  rowTextContent: {
    flexShrink: 1,
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  policyContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  policyOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  policyLabel: {
    fontWeight: "600",
    marginBottom: 2,
  },
  policyDesc: {
    fontSize: 12,
  },
  tabContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  gap12: {
    gap: 12,
  },
  flex1: {
    flex: 1,
  },
  marginBottom12: {
    marginBottom: 12,
  },
  footer: {
    marginTop: 20,
    alignItems: "center",
    paddingBottom: 40,
  },
  versionText: {
    fontSize: 12,
    opacity: 0.6,
  },
  securityIconBox: {
    backgroundColor: "rgba(52, 199, 89, 0.1)",
  },
  organizerIconBox: {
    backgroundColor: "rgba(155, 89, 182, 0.1)",
  },
  libraryIconBox: {
    backgroundColor: "rgba(255, 215, 0, 0.1)",
  },
  competitionIconBox: {
    backgroundColor: "rgba(255, 100, 100, 0.1)",
  },
  interfaceIconBoxDark: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  interfaceIconBoxLight: {
    backgroundColor: "#E0E0E0",
  },
  animationsIconBox: {
    backgroundColor: "rgba(151, 71, 255, 0.1)",
  },
  technicalIconBox: {
    backgroundColor: "rgba(128, 128, 128, 0.1)",
  },
  reportIconBox: {
    backgroundColor: "rgba(231, 76, 60, 0.1)",
  },
  passwordIconBox: {
    backgroundColor: "rgba(255, 149, 0, 0.1)",
  },
  helloAssoIconBox: {
    backgroundColor: "rgba(0, 184, 148, 0.1)",
  },
});
