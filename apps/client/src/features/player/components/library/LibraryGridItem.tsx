import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { AppText } from "../../../../components/AppText";
import { AppTheme } from "../../../../context/ThemeContext";
import { TrackData } from "../../context/PlayerContext";
import { libraryStyles as styles } from "./library.styles";

interface LibraryGridItemProps {
  item: { title: string; data: TrackData[] };
  currentTheme: AppTheme;
  isDark: boolean;
  onPress: (item: { title: string; data: TrackData[] }) => void;
}

export const LibraryGridItem = React.memo(
  ({ item, currentTheme, isDark, onPress }: LibraryGridItemProps) => (
    <TouchableOpacity
      accessibilityRole="button"
      testID={`library-section-${item.title}`}
      style={[
        styles.gridItem,
        isDark ? styles.gridItemDark : styles.gridItemLight,
      ]}
      onPress={() => onPress(item)}
    >
      <View
        style={[
          styles.gridItemBackground,
          { backgroundColor: currentTheme.primary },
        ]}
      >
        <Text style={styles.gridIcon}>{item.title.charAt(0)}</Text>
      </View>
      <View style={styles.gridContent}>
        <AppText
          variant="body"
          weight="600"
          color={currentTheme.text}
          numberOfLines={1}
        >
          {item.title}
        </AppText>
        <AppText variant="caption" color={currentTheme.textSecondary}>
          {item.data.length} titres
        </AppText>
      </View>
    </TouchableOpacity>
  ),
);
