import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  // Container & Card
  cardContainer: {
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 8,
  },
  card: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
  },
  collapsedCardHeight: {
    height: 120,
  },

  // Header
  cardHeader: {
    height: 120,
    position: "relative",
    width: "100%",
  },
  coloredBackground: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 20,
    width: "100%",
  },
  curveSvg: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    transform: [{ translateY: -1 }],
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    paddingBottom: 20,
    paddingHorizontal: 20,
    width: "100%",
  },
  logoContainer: {
    position: "absolute",
    left: 20,
    top: 25,
  },
  logoImage: {
    width: 60,
    height: 60,
    tintColor: "white",
  },
  titleContainer: {
    alignItems: "center",
    paddingLeft: 40,
  },
  typeLabel: {
    color: "white",
    fontSize: 22,
    letterSpacing: 1,
    textAlign: "center",
  },
  statusTag: {
    marginTop: 5,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  seasonLabel: {
    fontSize: 20,
    marginTop: 4,
  },
  optionsButton: {
    position: "absolute",
    right: 20,
    top: 25,
    padding: 4,
  },

  // Body
  cardBody: {
    flexDirection: "row",
    padding: 20,
    paddingTop: 10,
    flex: 1,
  },
  infoColumn: {
    flex: 1,
    paddingRight: 10,
  },
  nameContainer: {
    marginBottom: 15,
  },
  nameValue: {
    fontSize: 18,
    marginBottom: 4,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  infoGroup: {
    marginBottom: 8,
  },
  label: {
    marginBottom: 2,
  },
  value: {
    fontSize: 13,
  },
  valueWrap: {
    flexWrap: "wrap",
  },
  photoColumn: {
    width: 110,
    alignItems: "center",
    gap: 15,
  },
  photoPlaceholder: {
    width: 90,
    height: 110,
    backgroundColor: "#F0F0F0",
    justifyContent: "center",
    alignItems: "center",
  },
  wdsfPhotoBorder: {
    // Optional border style
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  qrThumbnail: {
    padding: 2,
  },

  // Barcode
  barcodeWrapper: {
    marginTop: 10,
    width: 100,
    alignItems: "center",
    borderRadius: 4,
  },
  barcodeContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  barcodeInner: {
    flexDirection: "row",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "white",
    paddingHorizontal: 5,
    paddingVertical: 5,
    width: "100%",
    borderRadius: 4,
  },
  barcodeTextWrapper: {
    backgroundColor: "white",
    paddingHorizontal: 4,
    borderRadius: 2,
    marginTop: 2,
  },
  barcodeText: {
    fontSize: 10,
    color: "black",
    textAlign: "center",
  },
  barcodeLine: {
    height: 40,
    backgroundColor: "black",
  },

  // Footer
  cardFooter: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  sectionBlock: {
    marginBottom: 15,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  valueRight: {
    textAlign: "right",
  },
  federationName: {
    marginBottom: 4,
  },
  contactButton: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 10,
  },
  contactButtonText: {
    fontSize: 14,
  },
  validityContainer: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#33333320",
    paddingTop: 10,
  },
  validityDate: {
    marginTop: 2,
  },
});
