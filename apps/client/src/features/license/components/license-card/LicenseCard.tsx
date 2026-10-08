import { View } from "react-native";
import { theme } from "../../../../theme";
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
  collapsed = false,
  onOptions,
  style,
  testID,
}) => {
  const isFFD = type === "FFD";
  const isDark = themeOverride === "dark";
  const config = getLicenseConfig(type, isDark);

  const qrData = buildLicenseQrData(user, type);

  return (
    <View
      testID={testID}
      style={[
        styles.cardContainer,
        style,
        collapsed && { marginBottom: -theme.spacing.xl },
      ]}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: config.cardBackground,
            borderColor: config.borderColor,
          },
          collapsed && styles.collapsedCardHeight,
          style,
        ]}
      >
        <LicenseCardHeader
          isFFD={isFFD}
          config={config}
          user={user}
          onOptions={onOptions}
        />

        {!collapsed && (
          <>
            <LicenseCardBody
              isFFD={isFFD}
              config={config}
              user={user}
              photoUri={photoUri}
              qrData={qrData}
              onShowQr={onShowQr}
            />
            <LicenseCardFooter isFFD={isFFD} config={config} user={user} />
          </>
        )}
      </View>
    </View>
  );
};
