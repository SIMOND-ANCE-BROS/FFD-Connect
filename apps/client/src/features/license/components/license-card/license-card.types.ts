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
}

export interface LicenseCardProps {
  type: LicenseType;
  user: LicenseUser;
  photoUri: string | null;
  onShowQr: () => void;
  themeOverride?: "light" | "dark";
  collapsed?: boolean;
  onOptions?: () => void;
  style?: ViewStyle | ViewStyle[];
  testID?: string;
}
