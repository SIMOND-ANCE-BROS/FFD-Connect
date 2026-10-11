import React from "react";
import { StyleSheet, View } from "react-native";

import { BetaNotice } from "../../../../components/BetaNotice";
import { getEventsSourceNotice } from "../../utils/eventsSourceNotice";

type Props = Parameters<typeof getEventsSourceNotice>[0];

/**
 * Explains where the events (épreuves) of a federation competition come from
 * (deduced from the circular / description, or not available yet). The
 * circular itself opens from the programme block's « Circulaire » button: one
 * button, not one per block.
 */
export const CompetitionEventsSourceNotice = (
  props: Props,
): React.JSX.Element | null => {
  const notice = getEventsSourceNotice(props);
  if (!notice) return null;

  return (
    <View style={styles.container} testID="competition-events-source-notice">
      <BetaNotice
        title={notice.copy.title}
        message={notice.copy.message}
        testID="competition-events-source-notice-banner"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
});
