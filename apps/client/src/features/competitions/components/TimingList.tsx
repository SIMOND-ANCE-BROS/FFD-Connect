import { Clock, Coffee, Mic2, Trophy } from "lucide-react-native";
import React, { useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import { ScheduleItem } from "../context/CompetitionContext";
import { theme as themeTokens } from "../../../theme";

// « Maintenant » marker: white text sits on it, so the deep red (4.83:1 in
// both themes), not the dark theme's bright danger (3.76:1).
const NOW_FILL = themeTokens.colors.error;

interface TimingListProps {
  schedule: ScheduleItem[];
  myEventIds: string[];
  delayMinutes?: number;
}

export const TimingList: React.FC<TimingListProps> = ({
  schedule,
  myEventIds,
  delayMinutes = 0,
}) => {
  const { theme } = useTheme();
  const [filterMyEvents, setFilterMyEvents] = useState(false);
  const [now, setNow] = useState(new Date());

  // Update time every 30 seconds
  React.useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const filteredSchedule = filterMyEvents
    ? schedule.filter(
        (item) => item.eventId != null && myEventIds.includes(item.eventId),
      )
    : schedule;

  const renderItem = ({
    item,
    index,
  }: {
    item: ScheduleItem;
    index: number;
  }) => {
    const scheduledDate = new Date(item.startTime);
    const scheduledTime = scheduledDate.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    // Calculate Estimated Time
    const estimatedDate = new Date(
      scheduledDate.getTime() + delayMinutes * 60000,
    );
    const estimatedTime = estimatedDate.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const isDelayed = delayMinutes > 0;

    // Logic for Current Time Line
    let showTimeLine = false;
    const hasNextItem = index + 1 < filteredSchedule.length;
    const nextItem = filteredSchedule[index + 1];

    if (now >= estimatedDate) {
      if (hasNextItem) {
        const nextEstimatedDate = new Date(
          new Date(nextItem.startTime).getTime() + delayMinutes * 60000,
        );
        if (now < nextEstimatedDate) {
          showTimeLine = true;
        }
      } else {
        // Last item
        const oneHourLater = new Date(estimatedDate.getTime() + 60 * 60000);
        if (now < oneHourLater) {
          showTimeLine = true;
        }
      }
    }

    // Special case: Show line BEFORE the first item if we are currently before it
    const showTimeLineBefore = index === 0 && now < estimatedDate;

    const isMyEvent = item.eventId != null && myEventIds.includes(item.eventId);

    const getIcon = () => {
      const color = isMyEvent ? "#FFFFFF" : theme.textSecondary;
      switch (item.type) {
        case "ROUND":
          return <Trophy size={16} color={color} />;
        case "BREAK":
          return <Coffee size={16} color={color} />;
        case "CEREMONY":
          return <Mic2 size={16} color={color} />;
        default:
          return <Clock size={16} color={color} />;
      }
    };

    return (
      <Animated.View
        key={item.id}
        entering={FadeIn}
        exiting={FadeOut}
        layout={LinearTransition.springify()}
      >
        {showTimeLineBefore && (
          <View style={styles.timeLineContainer}>
            <View style={[styles.timeLine, { backgroundColor: NOW_FILL }]} />
            <View style={[styles.timeLineBadge, { backgroundColor: NOW_FILL }]}>
              <AppText variant="caption" weight="600" color="white">
                Maintenant
              </AppText>
            </View>
            <View style={[styles.timeLine, { backgroundColor: NOW_FILL }]} />
          </View>
        )}

        <View
          style={[
            styles.row,
            {
              backgroundColor: isMyEvent
                ? theme.primaryFill
                : item.type === "BREAK"
                  ? theme.surface
                  : "transparent",
            },
            // Removed border bottom if using card style or ensure border color matches theme
            { borderBottomColor: theme.border },
            isMyEvent && { borderColor: theme.primary },
          ]}
        >
          <View style={styles.timeContainer}>
            {/* Estimated Time (Prominent) */}
            <AppText
              variant="body"
              weight="600"
              // On « my passage » rows (primaryFill) the time stays white:
              // red on that blue was ~2:1 (1.3:1 in dark). The struck-through
              // scheduled time below still shows the delay.
              color={
                isMyEvent
                  ? theme.onPrimary
                  : isDelayed
                    ? theme.dangerText
                    : theme.text
              }
            >
              {estimatedTime}
            </AppText>

            {/* Scheduled Time (Strikethrough if delayed) */}
            {isDelayed && (
              <AppText
                variant="caption"
                style={styles.strikethrough}
                color={isMyEvent ? "white" : theme.textSecondary}
              >
                {scheduledTime}
              </AppText>
            )}
          </View>
          <View style={styles.infoContainer}>
            <View style={styles.rowContent}>
              {getIcon()}
              <AppText
                variant="body"
                color={isMyEvent ? "white" : theme.text}
                numberOfLines={1}
              >
                {item.title}
              </AppText>
            </View>
            {isMyEvent && (
              <View style={[styles.badge, { backgroundColor: theme.surface }]}>
                <AppText variant="caption" color={theme.primary} weight="600">
                  MOI
                </AppText>
              </View>
            )}
          </View>
        </View>

        {showTimeLine && (
          <View style={styles.timeLineContainer}>
            <View style={[styles.timeLine, { backgroundColor: NOW_FILL }]} />
            <View style={[styles.timeLineBadge, { backgroundColor: NOW_FILL }]}>
              <AppText variant="caption" weight="600" color="white">
                Maintenant
              </AppText>
            </View>
            <View style={[styles.timeLine, { backgroundColor: NOW_FILL }]} />
          </View>
        )}
      </Animated.View>
    );
  };

  if (schedule.length === 0) {
    return (
      <View style={[styles.emptyContainer, styles.transparentBackground]}>
        <Clock
          size={48}
          color={theme.textSecondary}
          style={styles.clockMargin}
        />
        <AppText
          variant="h3"
          style={[styles.emptyTitle, { color: theme.text }]}
        >
          Timing indisponible
        </AppText>
        <AppText
          variant="body"
          style={[styles.emptySubtitle, { color: theme.textSecondary }]}
        >
          Le timing détaillé de cette compétition n'a pas encore été publié.
        </AppText>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.filterContainer}>
        <AppText
          variant="body"
          style={[styles.filterText, { color: theme.text }]}
          // The switch carries the label for screen readers.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          Mes passages uniquement
        </AppText>
        <Switch
          value={filterMyEvents}
          onValueChange={setFilterMyEvents}
          accessibilityLabel="Mes passages uniquement"
          accessibilityHint="N'affiche que les passages où vous êtes inscrit"
          // The border token is ~1.2:1: the off track must stay visible.
          trackColor={{ false: theme.textSecondary, true: theme.primary }}
          thumbColor={"white"}
          ios_backgroundColor={theme.textSecondary}
        />
      </View>

      {filteredSchedule.map((item, index) => renderItem({ item, index }))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderTopLeftRadius: 16, // Assuming it slides up or just looks nice
    borderTopRightRadius: 16,
    marginTop: 10,
  },
  emptyContainer: {
    padding: 20,
    alignItems: "center",
  },
  filterContainer: {
    flexDirection: "row",
    justifyContent: "flex-end", // Align filter to right
    alignItems: "center",
    marginBottom: 16,
  },
  transparentBackground: {
    backgroundColor: "transparent",
  },
  clockMargin: {
    marginBottom: 12,
  },
  emptyTitle: {
    textAlign: "center",
    marginBottom: 8,
  },
  emptySubtitle: {
    textAlign: "center",
  },
  filterText: {
    marginRight: 12,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    // borderBottomColor handled in render
    alignItems: "center",
    borderRadius: 8,
    marginBottom: 4,
  },
  timeContainer: {
    width: 60,
  },
  infoContainer: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  timeLineContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 4,
    justifyContent: "center",
  },
  timeLine: {
    flex: 1,
    height: 1,
    // backgroundColor handled in render
  },
  timeLineBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginHorizontal: 8,
    // backgroundColor handled in render
  },
  strikethrough: {
    textDecorationLine: "line-through",
    opacity: 0.7,
  },
  rowContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
});
