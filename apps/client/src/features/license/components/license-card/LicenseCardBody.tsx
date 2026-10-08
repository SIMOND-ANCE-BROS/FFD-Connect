import { Image } from "expo-image";
import { TouchableOpacity, View } from "react-native";
import { AppText } from "../../../../components/AppText";
import { QRCodeView } from "../QRCodeView.native";
import { Barcode } from "./Barcode";
import { styles } from "./license-card.styles";
import { LicenseConfig, LicenseUser } from "./license-card.types";

interface LicenseCardBodyProps {
  isFFD: boolean;
  config: LicenseConfig;
  user: LicenseUser;
  photoUri: string | null;
  qrData: string;
  onShowQr: () => void;
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
const buildInfoFields = (isFFD: boolean, user: LicenseUser): InfoField[] => {
  const fields: InfoField[] = [
    { label: isFFD ? "Numéro" : "MIN", value: user.licenseNumber },
    {
      label: isFFD ? "Date de naissance" : "Date of birth",
      value: user.birthDate,
    },
  ];
  if (user.country) fields.push({ label: "Nationality", value: user.country });
  if (user.ageGroup) fields.push({ label: "Age group", value: user.ageGroup });
  return fields;
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
          {user.firstName} {user.lastName}
        </AppText>
      </View>

      <View style={styles.infoGrid}>
        {buildInfoFields(isFFD, user).map((field) => (
          <View key={field.label} style={styles.infoCell}>
            <AppText
              variant="caption"
              numberOfLines={1}
              style={[styles.label, { color: config.labelColor }]}
            >
              {field.label}
            </AppText>
            <AppText
              variant="body"
              weight="600"
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[styles.cellValue, { color: config.textColor }]}
            >
              {field.value}
            </AppText>
          </View>
        ))}
      </View>
    </View>

    <View style={styles.photoColumn}>
      <View style={[styles.photoPlaceholder, !isFFD && styles.wdsfPhotoBorder]}>
        {user.photoUrl || photoUri ? (
          <Image
            source={{ uri: user.photoUrl ?? photoUri ?? undefined }}
            style={styles.photo}
            contentFit="cover"
          />
        ) : (
          <Image
            source={{ uri: "https://via.placeholder.com/150" }}
            style={styles.photo}
            contentFit="cover"
          />
        )}
      </View>

      {isFFD ? (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={onShowQr}
          style={styles.qrThumbnail}
        >
          <QRCodeView value={qrData} size={56} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={onShowQr}
          style={styles.barcodeWrapper}
          activeOpacity={0.7}
        >
          <Barcode value={user.licenseNumber} width={80} />
        </TouchableOpacity>
      )}
    </View>
  </View>
);
