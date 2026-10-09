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

  // Header — kept compact so a full card (FFD or WDSF) fits on one phone
  // screen without scrolling.
  cardHeader: {
    height: 88,
    position: "relative",
    width: "100%",
  },
  coloredBackground: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 16,
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
    paddingBottom: 16,
    paddingHorizontal: 16,
    width: "100%",
  },
  logoContainer: {
    position: "absolute",
    left: 16,
    top: 14,
  },
  logoImage: {
    width: 44,
    height: 44,
    tintColor: "white",
  },
  titleContainer: {
    alignItems: "center",
    paddingHorizontal: 48,
  },
  typeLabel: {
    fontSize: 18,
    letterSpacing: 1,
    textAlign: "center",
  },
  statusTag: {
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  seasonLabel: {
    fontSize: 16,
    marginTop: 2,
  },
  optionsButton: {
    position: "absolute",
    right: 16,
    top: 20,
    padding: 4,
  },

  // Body
  cardBody: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  infoColumn: {
    flex: 1,
    paddingRight: 8,
  },
  nameContainer: {
    marginBottom: 8,
  },
  nameValue: {
    fontSize: 18,
  },
  infoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  infoCell: {
    width: "50%",
    paddingRight: 6,
    marginBottom: 8,
  },
  // Columns share the width only when there are two of them: a lone column
  // (FFD number + birth date) takes the whole width instead of half of it.
  infoGridColumn: {
    flex: 1,
    minWidth: 0,
  },
  infoCellFullWidth: {
    width: "100%",
  },
  infoGroup: {
    marginBottom: 6,
  },
  label: {
    marginBottom: 1,
  },
  value: {
    fontSize: 13,
  },
  cellValue: {
    fontSize: 14,
  },
  valueWrap: {
    flexWrap: "wrap",
  },
  photoColumn: {
    width: 80,
    alignItems: "center",
    gap: 8,
  },
  photoPlaceholder: {
    width: 64,
    height: 80,
    borderRadius: 6,
    overflow: "hidden",
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
    width: 80,
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
    height: 32,
    backgroundColor: "black",
  },

  // Footer
  cardFooter: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  footerColumns: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 6,
  },
  footerColumn: {
    flex: 1,
  },
  sectionTitle: {
    marginBottom: 2,
  },
  contactButton: {
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
    marginTop: 10,
  },
  contactButtonText: {
    fontSize: 14,
  },
  validityContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#33333320",
    paddingTop: 8,
  },
  // Label and value wrap onto two lines with large accessibility font sizes
  // instead of being truncated.
  validityLabel: {
    flexShrink: 1,
  },
  validityValue: {
    flexShrink: 1,
    textAlign: "right",
  },
});
