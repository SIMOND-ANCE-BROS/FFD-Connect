import { ImageSource } from "expo-image";
import { LicenseConfig, LicenseType } from "./license-card.types";

/**
 * Fédération Française de Danse logo, shown on the FFD licence card only
 * (#312, risk accepted by the publisher). The app icon and login screen keep
 * FFD Connect's own artwork (`assets/logo.png`, #93).
 */
export const FFD_FEDERATION_LOGO =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../../../../assets/ffd-federation-logo.png") as ImageSource;

/**
 * FFD Connect's own icon (#93), shown tinted white on the STAFF / CLUB account
 * cards (#234): they hold no FFD licence, so no federation logo (#312).
 */
export const FFD_CONNECT_LOGO =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../../../../assets/logo.png") as ImageSource;

/**
 * World DanceSport Federation logotype, shown small on the WDSF licence card
 * only, as before. Bundled with the app (#602): it used to be loaded from
 * Wikimedia on every display (third-party request, missing offline).
 */
export const WDSF_LOGO =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../../../../assets/wdsf-logo.png") as ImageSource;

export function getLicenseConfig(
  type: LicenseType,
  isDark: boolean,
): LicenseConfig {
  const isFFD = type === "FFD";

  if (isFFD) {
    if (isDark) {
      return {
        backgroundColor: "#004481",
        textColor: "#E5E5EA",
        highlightColor: "#FF3B30",
        labelColor: "#66B2FF",
        logo: FFD_FEDERATION_LOGO,
        curveColor: "#1E1E1E",
        cardBackground: "#1E1E1E",
        borderColor: "#333",
        nameColor: "#FFFFFF",
        headerTextColor: "white",
      };
    }
    return {
      backgroundColor: "#004481",
      textColor: "#004481",
      highlightColor: "#E30613",
      labelColor: "#004481",
      logo: FFD_FEDERATION_LOGO,
      curveColor: "white",
      cardBackground: "white",
      borderColor: "#E0E0E0",
      nameColor: "#000000",
      headerTextColor: "white",
    };
  }

  if (isDark) {
    return {
      backgroundColor: "#121212",
      textColor: "#E5E5EA",
      highlightColor: "#FFD700",
      labelColor: "#B0B0B0",
      logo: WDSF_LOGO,
      curveColor: "#1E1E1E",
      cardBackground: "#1E1E1E",
      borderColor: "#333",
      nameColor: "#FFD700",
      headerTextColor: "white",
    };
  }
  return {
    backgroundColor: "#E6E6E6",
    textColor: "#333",
    highlightColor: "#B8860B",
    labelColor: "#666",
    logo: WDSF_LOGO,
    curveColor: "#FFF",
    cardBackground: "#FFF",
    borderColor: "#CCC",
    nameColor: "#B8860B",
    // The light WDSF header is light grey: white text vanished on it.
    headerTextColor: "#333",
  };
}
