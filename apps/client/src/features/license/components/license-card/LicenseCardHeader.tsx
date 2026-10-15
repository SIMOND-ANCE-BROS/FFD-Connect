import { Image } from "expo-image";
import { MoreHorizontal } from "lucide-react-native";
import { TouchableOpacity, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { AppText } from "../../../../components/AppText";
import { FFD_VALIDITY_UNKNOWN } from "../../utils/licenseSeason";
import { FFD_CONNECT_LOGO } from "./license-card.config";
import { styles } from "./license-card.styles";
import { LicenseConfig, LicenseUser } from "./license-card.types";

interface LicenseCardHeaderProps {
  isFFD: boolean;
  /** STAFF / CLUB account card: FFD Connect icon, no federation logo. */
  isAccount?: boolean;
  config: LicenseConfig;
  user: LicenseUser;
  onOptions?: () => void;
}

export const LicenseCardHeader: React.FC<LicenseCardHeaderProps> = ({
  isFFD,
  isAccount = false,
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
      height="20"
      width="100%"
      style={styles.curveSvg}
      preserveAspectRatio="none"
    >
      <Path d="M0 0 Q500 20 1000 0 V20 H0 Z" fill={config.cardBackground} />
    </Svg>

    <View style={styles.headerContent}>
      {/* Logo */}
      <View style={styles.logoContainer}>
        {isFFD && isAccount ? (
          <Image
            source={FFD_CONNECT_LOGO}
            style={styles.appLogoImage}
            contentFit="contain"
            testID="license-card-app-logo"
            accessible
            accessibilityRole="image"
            accessibilityLabel="FFD Connect"
            accessibilityHint="Carte de compte de l'application"
          />
        ) : isFFD ? (
          // White badge: the federation logo keeps its own colours (navy
          // text, red/blue dancer), which vanish on the blue header in both
          // themes. Tinting it white would alter the mark.
          <View style={styles.logoBadge} testID="license-card-ffd-logo">
            <Image
              source={config.logo}
              style={styles.logoImage}
              contentFit="contain"
              accessible
              accessibilityRole="image"
              accessibilityLabel="Logo de la Fédération Française de Danse"
              accessibilityHint="Fédération qui délivre cette licence"
            />
          </View>
        ) : (
          <Image
            source={config.logo}
            style={styles.wdsfLogoImage}
            contentFit="contain"
            testID="license-card-wdsf-logo"
            accessible
            accessibilityRole="image"
            accessibilityLabel="Logo de la World DanceSport Federation"
            accessibilityHint="Fédération qui délivre cette licence"
          />
        )}
      </View>

      {/* Title Centered */}
      {/* Licence type + season/status read together. */}
      <View style={styles.titleContainer} accessible>
        <AppText
          variant="h1"
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[styles.typeLabel, { color: config.headerTextColor }]}
        >
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
        ) : user.status && user.status !== FFD_VALIDITY_UNKNOWN ? (
          <View
            style={[styles.statusTag, { borderColor: config.highlightColor }]}
          >
            <AppText
              variant="caption"
              weight="bold"
              numberOfLines={1}
              style={{ color: config.highlightColor }}
            >
              {user.status.toUpperCase()}
            </AppText>
          </View>
        ) : null}
        {/* Unknown validity (#211): no header tag — the footer row already
            says « Validité non communiquée ». */}
      </View>

      {/* Options Menu Button */}
      {onOptions && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Options de la licence"
          accessibilityHint="Affiche les actions possibles sur cette licence"
          onPress={onOptions}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.optionsButton}
        >
          <MoreHorizontal size={24} color={config.headerTextColor} />
        </TouchableOpacity>
      )}
    </View>
  </View>
);
