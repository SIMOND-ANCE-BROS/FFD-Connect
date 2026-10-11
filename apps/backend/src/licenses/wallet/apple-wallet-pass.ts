import { disciplineLabel } from "../../common/competition-level";
import { parisEndOfDay, toLicenseQrExpiry } from "../qr/license-qr";

/**
 * Content of the Apple Wallet license pass (#162) — pure, no Nest, no I/O.
 *
 * Neutral wording on purpose (#160): the pass is produced by the FFD Connect
 * app and must not present itself as an official federation card. No
 * `webServiceURL` / `authenticationToken`: automatic updates are out of the
 * MVP (#167) — after a renewal the user adds the pass again, and the stable
 * `serialNumber` makes Wallet replace the previous one.
 */

export const APPLE_PASS_ORGANIZATION_NAME = "FFD Connect";
export const APPLE_PASS_DESCRIPTION = "FFD Connect — Licence";

/** App colours (theme `ffdBlue` background, white text, slate-300 labels). */
const PASS_COLORS = {
  backgroundColor: "rgb(0, 68, 129)",
  foregroundColor: "rgb(255, 255, 255)",
  labelColor: "rgb(203, 213, 225)",
} as const;

export interface ApplePassLicense {
  /** License id: stable across renewals, used for the serial number. */
  id: string;
  number: string;
  category: string;
  validUntil: Date;
  firstName: string;
  lastName: string;
}

export interface ApplePassField {
  key: string;
  label: string;
  value: string;
}

export interface ApplePassJson {
  formatVersion: 1;
  passTypeIdentifier: string;
  teamIdentifier: string;
  serialNumber: string;
  organizationName: string;
  description: string;
  logoText: string;
  backgroundColor: string;
  foregroundColor: string;
  labelColor: string;
  sharingProhibited: boolean;
  expirationDate: string;
  barcodes: {
    format: "PKBarcodeFormatQR";
    message: string;
    messageEncoding: "iso-8859-1";
    altText: string;
  }[];
  generic: {
    primaryFields: ApplePassField[];
    secondaryFields: ApplePassField[];
    auxiliaryFields: ApplePassField[];
    backFields: ApplePassField[];
  };
}

export interface BuildApplePassInput {
  passTypeIdentifier: string;
  teamIdentifier: string;
  license: ApplePassLicense;
  /** Signed QR content (exactly what the app displays and check-in reads). */
  qrMessage: string;
}

/** Stable per license: re-adding the pass replaces the previous one. */
export function applePassSerialNumber(licenseId: string): string {
  return `ffd-connect-license-${licenseId}`;
}

/** `YYYY-MM-DD` → `DD/MM/YYYY` (French display, no time zone involved). */
function frenchDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

/** Builds `pass.json` for a license pass (generic style). */
export function buildApplePassJson(input: BuildApplePassInput): ApplePassJson {
  const { license } = input;
  const expiryDay = toLicenseQrExpiry(license.validUntil);
  const holder =
    `${license.firstName} ${license.lastName}`.trim() || license.number;

  return {
    formatVersion: 1,
    passTypeIdentifier: input.passTypeIdentifier,
    teamIdentifier: input.teamIdentifier,
    serialNumber: applePassSerialNumber(license.id),
    organizationName: APPLE_PASS_ORGANIZATION_NAME,
    description: APPLE_PASS_DESCRIPTION,
    logoText: APPLE_PASS_ORGANIZATION_NAME,
    ...PASS_COLORS,
    // A license pass is personal; discourages AirDrop/Messages sharing.
    sharingProhibited: true,
    expirationDate: parisEndOfDay(expiryDay).toISOString(),
    barcodes: [
      {
        format: "PKBarcodeFormatQR",
        message: input.qrMessage,
        messageEncoding: "iso-8859-1",
        altText: license.number,
      },
    ],
    generic: {
      primaryFields: [{ key: "holder", label: "Titulaire", value: holder }],
      secondaryFields: [
        { key: "number", label: "N° de licence", value: license.number },
        {
          key: "category",
          label: "Type",
          value: disciplineLabel(license.category),
        },
      ],
      auxiliaryFields: [
        {
          key: "validUntil",
          label: "Valable jusqu'au",
          value: frenchDay(expiryDay),
        },
      ],
      backFields: [
        {
          key: "about",
          label: "À propos",
          value:
            "Pass généré par l'application FFD Connect à partir de votre licence. Présentez le QR code au contrôle d'accès. Après un renouvellement, ajoutez de nouveau le pass depuis l'application : il remplace celui-ci.",
        },
      ],
    },
  };
}
