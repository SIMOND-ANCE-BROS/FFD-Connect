import React from "react";
import { View } from "react-native";
import { AppText } from "../../../../components/AppText";
import type { AppTheme } from "../../../../context/ThemeContext";
import type { Event } from "../../context/CompetitionContext";
import { formatDiscipline } from "../../../../utils/discipline";
import { type EventGroup, eventVariantLabel } from "../../utils/eventGroups";
import { styles } from "./competition-detail.styles";

interface Props {
  currentTheme: AppTheme;
  group: EventGroup;
  /** Renders one event: the plain card, or a row of this group's card. */
  renderEvent: (event: Event, variantLabel?: string) => React.ReactNode;
}

/**
 * One card per discipline / age class / type, one row per level (a circular
 * lists each level as its own event). A lone event without a level keeps the
 * plain card.
 */
export function CompetitionEventGroupCard({
  currentTheme,
  group,
  renderEvent,
}: Props) {
  const [first] = group.events;
  if (group.events.length === 1 && eventVariantLabel(first) === null) {
    return <>{renderEvent(first)}</>;
  }

  return (
    <View
      testID={`event-group-${group.key}`}
      style={[styles.eventCard, { backgroundColor: currentTheme.surface }]}
    >
      <View style={styles.eventGroupHeader}>
        <AppText
          variant="h3"
          color={currentTheme.text}
          accessibilityRole="header"
        >
          {formatDiscipline(group.category)}
        </AppText>
        <AppText
          variant="caption"
          color={currentTheme.textSecondary}
          style={styles.eventDetails}
        >
          {group.dance && `${group.dance} • `}
          {group.ageGroup}
          {group.eventType === "SOLO" ? " • Solo" : " • Couple"}
        </AppText>
      </View>
      {group.events.map((event) => (
        <React.Fragment key={event.id}>
          {renderEvent(event, eventVariantLabel(event) ?? "Épreuve")}
        </React.Fragment>
      ))}
    </View>
  );
}
