import { FileText } from "lucide-react-native";
import React from "react";
import { Linking, StyleSheet, TouchableOpacity, View } from "react-native";

import { AppText } from "../../../../components/AppText";
import { BetaNotice } from "../../../../components/BetaNotice";
import { EVENTS_SOURCE_NOTICES } from "../../../../constants/betaNotices";
import { useTheme } from "../../../../context/ThemeContext";
import { getEventsSourceNotice } from "../../utils/eventsSourceNotice";

type Props = Parameters<typeof getEventsSourceNotice>[0];

/**
 * Explains where the events (épreuves) of a federation competition come from
 * (deduced from the circular / description, or not available yet), with a
 * button to open the circular when known. The button sits outside the
 * notice: the notice is a single accessibility element.
 */
export const CompetitionEventsSourceNotice = (
  props: Props,
): React.JSX.Element | null => {
  const { theme } = useTheme();
  const notice = getEventsSourceNotice(props);
  if (!notice) return null;
  const { circularUrl } = notice;

  return (
    <View style={styles.container} testID="competition-events-source-notice">
      <BetaNotice
        title={notice.copy.title}
        message={notice.copy.message}
        testID="competition-events-source-notice-banner"
      />
      {circularUrl ? (
        <TouchableOpacity
          style={[styles.link, { borderColor: theme.primary }]}
          onPress={() => {
            Linking.openURL(circularUrl).catch(() => {});
          }}
          accessibilityRole="link"
          accessibilityLabel={EVENTS_SOURCE_NOTICES.openCircular}
          accessibilityHint="Ouvre la circulaire de la compétition"
          testID="competition-events-source-open-circular"
        >
          <FileText size={16} color={theme.primary} />
          <AppText variant="caption" weight="600" color={theme.primary}>
            {EVENTS_SOURCE_NOTICES.openCircular}
          </AppText>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  link: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
});
