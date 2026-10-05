import { Image } from "expo-image";
import { MoreHorizontal } from "lucide-react-native";
import { TouchableOpacity, View } from "react-native";
import Svg, { Path, SvgUri } from "react-native-svg";
import { AppText } from "../../../../components/AppText";
import { styles } from "./license-card.styles";
import { LicenseConfig, LicenseUser } from "./license-card.types";

interface LicenseCardHeaderProps {
  isFFD: boolean;
  config: LicenseConfig;
  user: LicenseUser;
  onOptions?: () => void;
}

export const LicenseCardHeader: React.FC<LicenseCardHeaderProps> = ({
  isFFD,
  config,
  user,
  onOptions,
}) => (
  <View style={styles.cardHeader}>
    {/* Background */}
    <View
      style={[
        styles.coloredBackground,
        { backgroundColor: config.backgroundColor },
      ]}
    />

    {/* Curved Edge */}
    <Svg
      height="30"
      width="100%"
      style={styles.curveSvg}
      preserveAspectRatio="none"
    >
      <Path d="M0 0 Q500 30 1000 0 V30 H0 Z" fill={config.cardBackground} />
    </Svg>

    <View style={styles.headerContent}>
      {/* Logo */}
      <View style={styles.logoContainer}>
        {isFFD ? (
          <Image
            source={config.logo}
            style={styles.logoImage}
            contentFit="contain"
          />
        ) : (
          <SvgUri width="60" height="60" uri={config.logo as string} />
        )}
      </View>

      {/* Title Centered */}
      <View style={styles.titleContainer}>
        <AppText variant="h1" style={styles.typeLabel}>
          {user.type}
        </AppText>
        {user.season ? (
          <AppText
            variant="body"
            weight="bold"
            style={[styles.seasonLabel, { color: config.highlightColor }]}
          >
            {user.season}
          </AppText>
        ) : (
          <View
            style={[styles.statusTag, { borderColor: config.highlightColor }]}
          >
            <AppText
              variant="caption"
              weight="bold"
              style={{ color: config.highlightColor }}
            >
              {user.status?.toUpperCase()}
            </AppText>
          </View>
        )}
      </View>

      {/* Options Menu Button */}
      {onOptions && (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={onOptions}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.optionsButton}
        >
          <MoreHorizontal size={24} color="white" />
        </TouchableOpacity>
      )}
    </View>
  </View>
);
