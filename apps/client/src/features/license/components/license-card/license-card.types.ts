import { ImageSource } from "expo-image";
import { ViewStyle } from "react-native";

export type LicenseType = "FFD" | "WDSF";

export interface LicenseUser {
  firstName: string;
  lastName: string;
  birthDate: string;
  licenseNumber: string; // MIN for WDSF
  structure?: string; // Member Body for WDSF
  insurance?: string;
  validUntil: string;
  /** Date d'expiration ISO brute (non formatée) — pour le calcul d'expiration. */
  validUntilRaw?: string;
  season?: string;
  type: string; // "LICENCE D" or "ATHLETE'S LICENSE"
  status?: string; // "Active" for WDSF
  country?: string; // "FRA" for WDSF
  ageGroup?: string;
  partnerName?: string;
  partnerAgeGroup?: string;
  administrator?: string;
  /** URL de la photo de licence (ex. renvoyée par l'API WDSF si disponible). */
  photoUrl?: string;
  /**
   * Contenu du QR signé par le serveur (#168), à afficher tel quel. Gardé dans
   * le snapshot hors ligne. Absent ⇒ repli sur l'ancien contenu (backend ancien).
   */
  qrCode?: string;
  /**
   * The server can issue an Apple Wallet pass for this license (#163). Kept in
   * the offline snapshot so the button stays visible (disabled) offline.
   */
  appleWalletAvailable?: boolean;
}

export interface LicenseConfig {
  backgroundColor: string;
  textColor: string;
  highlightColor: string;
  labelColor: string;
  logo: ImageSource | string;
  curveColor: string;
  cardBackground: string;
  borderColor: string;
  nameColor: string;
  /**
   * Title and menu icon of the coloured header. Must contrast with
   * `backgroundColor`: the header is what peeks out of the stacked wallet.
   */
  headerTextColor: string;
}

export interface LicenseCardProps {
  type: LicenseType;
  user: LicenseUser;
  photoUri: string | null;
  /**
   * Opens the QR in full screen. Absent ⇒ the card has no QR code (a STAFF or
   * CLUB account holds no license to scan, #234).
   */
  onShowQr?: () => void;
  themeOverride?: "light" | "dark";
  onOptions?: () => void;
  style?: ViewStyle | ViewStyle[];
  testID?: string;
}
