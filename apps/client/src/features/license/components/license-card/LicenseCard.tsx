import { View } from "react-native";
import { buildLicenseQrData } from "../../utils/licenseQrData";
import { LicenseCardBody } from "./LicenseCardBody";
import { LicenseCardFooter } from "./LicenseCardFooter";
import { LicenseCardHeader } from "./LicenseCardHeader";
import { getLicenseConfig } from "./license-card.config";
import { styles } from "./license-card.styles";
import { LicenseCardProps } from "./license-card.types";

export const LicenseCard: React.FC<LicenseCardProps> = ({
  type,
  user,
  photoUri,
  onShowQr,
  themeOverride,
  onOptions,
  style,
  testID,
}) => {
  const isFFD = type === "FFD";
  const isDark = themeOverride === "dark";
  const config = getLicenseConfig(type, isDark);

  const qrData = buildLicenseQrData(user, type);

  return (
    <View testID={testID} style={[styles.cardContainer, style]}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: config.cardBackground,
            borderColor: config.borderColor,
          },
          style,
        ]}
      >
        <LicenseCardHeader
          isFFD={isFFD}
          config={config}
          user={user}
          onOptions={onOptions}
        />

        {/* Always the full card, even behind another one in the wallet: the
            stack only offsets it, so bringing it forward never resizes it. */}
        <LicenseCardBody
          isFFD={isFFD}
          config={config}
          user={user}
          photoUri={photoUri}
          qrData={qrData}
          onShowQr={onShowQr}
        />
        <LicenseCardFooter isFFD={isFFD} config={config} user={user} />
      </View>
    </View>
  );
};
