import { Linking, TouchableOpacity, View } from "react-native";
import { AppText } from "../../../../components/AppText";
import { styles } from "./license-card.styles";
import { LicenseConfig, LicenseUser } from "./license-card.types";

interface LicenseCardFooterProps {
  isFFD: boolean;
  config: LicenseConfig;
  user: LicenseUser;
}

interface FooterColumnProps {
  title: string;
  value?: string;
  detail?: string;
  titleColor: string;
  config: LicenseConfig;
  bold?: boolean;
}

/** One titled block of the footer; blocks sit side by side to save height. */
const FooterColumn: React.FC<FooterColumnProps> = ({
  title,
  value,
  detail,
  titleColor,
  config,
  bold = false,
}) => (
  <View style={styles.footerColumn}>
    <AppText
      variant="caption"
      weight={bold ? "bold" : undefined}
      style={[styles.sectionTitle, { color: titleColor }]}
    >
      {title}
    </AppText>
    <AppText
      variant="body"
      numberOfLines={2}
      style={[styles.value, styles.valueWrap, { color: config.textColor }]}
    >
      {value}
    </AppText>
    {detail ? (
      <AppText
        variant="caption"
        numberOfLines={1}
        style={{ color: config.labelColor }}
      >
        {detail}
      </AppText>
    ) : null}
  </View>
);

export const LicenseCardFooter: React.FC<LicenseCardFooterProps> = ({
  isFFD,
  config,
  user,
}) => (
  <View style={styles.cardFooter}>
    {!isFFD && (
      <View style={styles.footerColumns}>
        {user.partnerName ? (
          <FooterColumn
            title="My partner"
            value={user.partnerName}
            detail={user.partnerAgeGroup}
            titleColor={config.highlightColor}
            config={config}
            bold
          />
        ) : null}
        <FooterColumn
          title="My federation"
          value={user.structure}
          detail={user.administrator}
          titleColor={config.highlightColor}
          config={config}
          bold
        />
      </View>
    )}

    {isFFD && (user.structure || user.insurance) ? (
      <View style={styles.footerColumns}>
        {user.structure ? (
          <FooterColumn
            title="Structure"
            value={user.structure}
            titleColor={config.labelColor}
            config={config}
          />
        ) : null}
        {user.insurance ? (
          <FooterColumn
            title="Assurance"
            value={user.insurance}
            titleColor={config.labelColor}
            config={config}
          />
        ) : null}
      </View>
    ) : null}

    <View style={styles.validityContainer}>
      <AppText variant="caption" style={{ color: config.labelColor }}>
        {isFFD ? "Licence valable jusqu'au" : "License expires on"}
      </AppText>
      <AppText variant="body" weight="bold" style={{ color: config.textColor }}>
        {user.validUntil}
      </AppText>
    </View>

    {!isFFD && (
      <TouchableOpacity
        accessibilityRole="button"
        style={[
          styles.contactButton,
          { backgroundColor: config.highlightColor },
        ]}
        onPress={() => {
          Linking.openURL("mailto:secretariat.dtn@ffdanse.fr").catch(() => {});
        }}
      >
        <AppText
          variant="button"
          style={[styles.contactButtonText, { color: config.cardBackground }]}
        >
          Contact my federation
        </AppText>
      </TouchableOpacity>
    )}
  </View>
);
