import { Image } from "expo-image";
import { User } from "lucide-react-native";
import { TouchableOpacity, View } from "react-native";
import { AppText } from "../../../../components/AppText";
import { QRCodeView } from "../QRCodeView.native";
import { Barcode } from "./Barcode";
import { LICENSE_CARD_TEXT_MAX_SCALE } from "./license-card.config";
import { styles } from "./license-card.styles";
import { LicenseConfig, LicenseUser } from "./license-card.types";
import { holderInitials } from "../../utils/holderInitials";

interface LicenseCardBodyProps {
  isFFD: boolean;
  config: LicenseConfig;
  user: LicenseUser;
  photoUri: string | null;
  qrData: string;
  /** Absent ⇒ no QR code on the card. */
  onShowQr?: () => void;
}

interface InfoField {
  label: string;
  value: string;
}

/**
 * Identity fields shown next to the photo. They are laid out as a two-column
 * grid (instead of one field per line) so the whole card stays short enough
 * to fit on a phone screen without scrolling.
 */
const buildPrimaryFields = (isFFD: boolean, user: LicenseUser): InfoField[] =>
  [
    { label: isFFD ? "Numéro" : "MIN", value: user.licenseNumber },
    {
      label: isFFD ? "Date de naissance" : "Date of birth",
      value: user.birthDate,
    },
    // An empty value is a field the holder does not have (no license number
    // on a STAFF/CLUB card, #234): the row is hidden, never invented.
  ].filter((field) => field.value);

const buildExtraFields = (user: LicenseUser): InfoField[] => {
  const fields: InfoField[] = [];
  if (user.country) fields.push({ label: "Nationality", value: user.country });
  if (user.ageGroup) fields.push({ label: "Age group", value: user.ageGroup });
  return fields;
};

const buildInfoFields = (isFFD: boolean, user: LicenseUser): InfoField[] => [
  ...buildPrimaryFields(isFFD, user),
  ...buildExtraFields(user),
];

/**
 * FFD identity grid as explicit columns: the left one stacks the licence
 * number and the birth date; any extra field goes to the right column.
 */
const buildFfdColumns = (user: LicenseUser): InfoField[][] =>
  [buildPrimaryFields(true, user), buildExtraFields(user)].filter(
    (column) => column.length > 0,
  );

/** Holder name; a CLUB card has only a last name (the club's). */
const holderName = (user: LicenseUser): string =>
  [user.firstName, user.lastName].filter(Boolean).join(" ");

const InfoCell: React.FC<{
  field: InfoField;
  config: LicenseConfig;
  fullWidth?: boolean;
}> = ({ field, config, fullWidth = false }) => (
  // One screen-reader stop per field: "Numéro, FFD-2025-12345".
  <View
    accessible
    style={[styles.infoCell, fullWidth && styles.infoCellFullWidth]}
  >
    {/* No line limit: a label wraps rather than being cut with an ellipsis
        (narrow phones, large accessibility font sizes). */}
    <AppText
      variant="caption"
      style={[styles.label, { color: config.labelColor }]}
    >
      {field.label}
    </AppText>
    <AppText
      variant="body"
      weight="600"
      numberOfLines={1}
      adjustsFontSizeToFit
      // Fixed-size card cell (credit-card format): grows with the system
      // text size up to a cap, then the reader still gets the full value.
      maxFontSizeMultiplier={LICENSE_CARD_TEXT_MAX_SCALE}
      style={[styles.cellValue, { color: config.textColor }]}
    >
      {field.value}
    </AppText>
  </View>
);

/**
 * Shown when no licence photo is stored (#246): the holder's initials, or a
 * neutral silhouette, drawn locally. Never a remote placeholder image (the
 * former third-party service was gone and leaked the user's IP address).
 */
const PhotoPlaceholder: React.FC<{
  user: LicenseUser;
  config: LicenseConfig;
}> = ({ user, config }) => {
  const initials = holderInitials(user.firstName, user.lastName);
  return (
    <View
      testID="license-card-photo-placeholder"
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        initials
          ? `Aucune photo de licence, initiales ${initials}`
          : "Aucune photo de licence"
      }
      accessibilityHint="Photo d'identité du titulaire de la licence"
      style={[
        styles.photoFallback,
        { backgroundColor: config.backgroundColor },
      ]}
    >
      {initials ? (
        <AppText
          variant="h2"
          weight="bold"
          style={[styles.photoInitials, { color: config.headerTextColor }]}
        >
          {initials}
        </AppText>
      ) : (
        <User color={config.headerTextColor} size={32} />
      )}
    </View>
  );
};

export const LicenseCardBody: React.FC<LicenseCardBodyProps> = ({
  isFFD,
  config,
  user,
  photoUri,
  qrData,
  onShowQr,
}) => (
  <View style={styles.cardBody}>
    <View style={styles.infoColumn}>
      <View style={styles.nameContainer}>
        <AppText
          variant="h2"
          numberOfLines={2}
          style={[styles.nameValue, { color: config.nameColor }]}
        >
          {holderName(user)}
        </AppText>
      </View>

      {isFFD ? (
        // FFD: birth date sits right under the licence number (same column).
        <View style={styles.infoGrid} testID="license-card-identity">
          {buildFfdColumns(user).map((column, columnIndex) => (
            <View
              key={columnIndex === 0 ? "primary" : "secondary"}
              style={styles.infoGridColumn}
              testID={`license-card-identity-column-${columnIndex}`}
            >
              {column.map((field) => (
                <InfoCell
                  key={field.label}
                  field={field}
                  config={config}
                  fullWidth
                />
              ))}
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.infoGrid} testID="license-card-identity">
          {buildInfoFields(isFFD, user).map((field) => (
            <InfoCell key={field.label} field={field} config={config} />
          ))}
        </View>
      )}
    </View>

    <View style={styles.photoColumn}>
      <View style={[styles.photoPlaceholder, !isFFD && styles.wdsfPhotoBorder]}>
        {user.photoUrl || photoUri ? (
          <Image
            source={{ uri: user.photoUrl ?? photoUri ?? undefined }}
            style={styles.photo}
            contentFit="cover"
            accessible
            accessibilityRole="image"
            accessibilityLabel="Photo de licence"
            accessibilityHint="Photo d'identité du titulaire de la licence"
          />
        ) : (
          <PhotoPlaceholder user={user} config={config} />
        )}
      </View>

      {!onShowQr ? null : isFFD ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Afficher le QR code de la licence"
          accessibilityHint="Ouvre le QR code en grand pour le contrôle"
          onPress={onShowQr}
          style={styles.qrThumbnail}
          testID="license-card-show-qr"
        >
          <QRCodeView value={qrData} size={56} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Afficher le code-barres de la licence"
          accessibilityHint="Ouvre le code-barres en grand pour le contrôle"
          onPress={onShowQr}
          style={styles.barcodeWrapper}
          testID="license-card-show-barcode"
          activeOpacity={0.7}
        >
          <Barcode value={user.licenseNumber} width={80} />
        </TouchableOpacity>
      )}
    </View>
  </View>
);
