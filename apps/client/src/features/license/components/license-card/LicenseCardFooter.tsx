import { Linking, TouchableOpacity, View } from "react-native";
import { AppText } from "../../../../components/AppText";
import { styles } from "./license-card.styles";
import { LicenseConfig, LicenseUser } from "./license-card.types";

interface LicenseCardFooterProps {
  isFFD: boolean;
  config: LicenseConfig;
  user: LicenseUser;
}

export const LicenseCardFooter: React.FC<LicenseCardFooterProps> = ({
  isFFD,
  config,
  user,
}) => (
  <View style={styles.cardFooter}>
    {!isFFD && (
      <>
        {user.partnerName && (
          <View style={styles.sectionBlock}>
            <AppText
              variant="caption"
              weight="bold"
              style={[styles.sectionTitle, { color: config.highlightColor }]}
            >
              My partner
            </AppText>
            <View style={styles.rowBetween}>
              <AppText variant="caption" style={{ color: config.labelColor }}>
                Name
              </AppText>
              <AppText
                variant="body"
                style={[styles.valueRight, { color: config.textColor }]}
              >
                {user.partnerName}
              </AppText>
            </View>
            {user.partnerAgeGroup && (
              <View style={styles.rowBetween}>
                <AppText variant="caption" style={{ color: config.labelColor }}>
                  Our age group
                </AppText>
                <AppText
                  variant="body"
                  style={[styles.valueRight, { color: config.textColor }]}
                >
                  {user.partnerAgeGroup}
                </AppText>
              </View>
            )}
          </View>
        )}

        <View style={styles.sectionBlock}>
          <AppText
            variant="caption"
            weight="bold"
            style={[styles.sectionTitle, { color: config.highlightColor }]}
          >
            My federation
          </AppText>
          <AppText
            variant="body"
            style={[styles.federationName, { color: config.textColor }]}
          >
            {user.structure}
          </AppText>
          {user.administrator && (
            <View style={styles.rowBetween}>
              <AppText variant="caption" style={{ color: config.labelColor }}>
                Administrator
              </AppText>
              <AppText variant="body" style={{ color: config.textColor }}>
                {user.administrator}
              </AppText>
            </View>
          )}
        </View>

        {/* Contact Button */}
        <TouchableOpacity
          accessibilityRole="button"
          style={[
            styles.contactButton,
            { backgroundColor: config.highlightColor },
          ]}
          onPress={() => {
            Linking.openURL("mailto:secretariat.dtn@ffdanse.fr").catch(
              () => {},
            );
          }}
        >
          <AppText
            variant="button"
            style={[styles.contactButtonText, { color: config.cardBackground }]}
          >
            Contact my federation
          </AppText>
        </TouchableOpacity>
      </>
    )}

    {isFFD && user.structure && (
      <View style={styles.infoGroup}>
        <AppText
          variant="caption"
          style={[styles.label, { color: config.labelColor }]}
        >
          Structure :
        </AppText>
        <AppText
          variant="body"
          style={[styles.value, styles.valueWrap, { color: config.textColor }]}
        >
          {user.structure}
        </AppText>
      </View>
    )}

    {isFFD && user.insurance && (
      <View style={styles.infoGroup}>
        <AppText
          variant="caption"
          style={[styles.label, { color: config.labelColor }]}
        >
          Assurance :
        </AppText>
        <AppText
          variant="body"
          style={[styles.value, { color: config.textColor }]}
        >
          {user.insurance}
        </AppText>
      </View>
    )}

    <View style={styles.validityContainer}>
      <AppText variant="caption" style={{ color: config.labelColor }}>
        {isFFD ? "Licence valable jusqu'au" : "License expires on"}
      </AppText>
      <AppText
        variant="body"
        weight="bold"
        style={[styles.validityDate, { color: config.textColor }]}
      >
        {user.validUntil}
      </AppText>
    </View>
  </View>
);
