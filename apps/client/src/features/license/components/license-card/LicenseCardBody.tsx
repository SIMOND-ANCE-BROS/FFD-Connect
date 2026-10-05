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
          style={[styles.nameValue, { color: config.nameColor }]}
        >
          {user.firstName} {user.lastName}
        </AppText>
      </View>

      <View style={styles.infoRow}>
        <View style={styles.infoGroup}>
          <AppText
            variant="caption"
            style={[styles.label, { color: config.labelColor }]}
          >
            {isFFD ? "Numéro :" : "MIN"}
          </AppText>
          <AppText
            variant="body"
            weight="600"
            style={{ color: config.textColor }}
          >
            {user.licenseNumber}
          </AppText>
        </View>
      </View>

      <View style={styles.infoGroup}>
        <AppText
          variant="caption"
          style={[styles.label, { color: config.labelColor }]}
        >
          {isFFD ? "Date de naissance :" : "Date of birth"}
        </AppText>
        <AppText
          variant="body"
          weight="600"
          style={{ color: config.textColor }}
        >
          {user.birthDate}
        </AppText>
      </View>

      {user.country && (
        <View style={styles.infoGroup}>
          <AppText
            variant="caption"
            style={[styles.label, { color: config.labelColor }]}
          >
            Nationality
          </AppText>
          <AppText
            variant="body"
            weight="600"
            style={{ color: config.textColor }}
          >
            {user.country}
          </AppText>
        </View>
      )}
      {user.ageGroup && (
        <View style={styles.infoGroup}>
          <AppText
            variant="caption"
            style={[styles.label, { color: config.labelColor }]}
          >
            Age group
          </AppText>
          <AppText
            variant="body"
            weight="600"
            style={{ color: config.textColor }}
          >
            {user.ageGroup}
          </AppText>
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
          <QRCodeView value={qrData} size={60} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={onShowQr}
          style={styles.barcodeWrapper}
          activeOpacity={0.7}
        >
          <Barcode value={user.licenseNumber} width={90} />
        </TouchableOpacity>
      )}
    </View>
  </View>
);
