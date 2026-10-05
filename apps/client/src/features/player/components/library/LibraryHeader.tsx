import { Trophy } from "lucide-react-native";
import React from "react";
import { TouchableOpacity, View } from "react-native";
import { AppText } from "../../../../components/AppText";
import { BackButton } from "../../../../components/BackButton";
import { AppTheme } from "../../../../context/ThemeContext";
import { TrackData } from "../../context/PlayerContext";
import { libraryStyles as styles } from "./library.styles";

interface LibraryHeaderProps {
  currentTheme: AppTheme;
  isDark: boolean;
  selectedSection: { title: string; data: TrackData[] } | null;
  onBackPress: () => void;
  onPerformancePress: () => void;
}

export const LibraryHeader = ({
  currentTheme,
  isDark,
  selectedSection,
  onBackPress,
  onPerformancePress,
}: LibraryHeaderProps) => {
  return (
    <View style={styles.header}>
      {selectedSection ? (
        <View style={styles.backButton}>
          <BackButton onPress={onBackPress} />
          <AppText variant="h2" style={styles.headerTitleSmall}>
            {selectedSection.title}
          </AppText>
        </View>
      ) : (
        <AppText variant="h1" color={currentTheme.text}>
          Bibliothèque
        </AppText>
      )}
      <View style={styles.headerActions}>
        <TouchableOpacity
          accessibilityRole="button"
          testID="library-performance-button"
          onPress={onPerformancePress}
          style={[
            styles.headerActionButton,
            isDark
              ? styles.headerActionButtonDark
              : styles.headerActionButtonLight,
            { borderColor: currentTheme.border },
          ]}
        >
          <Trophy color="#FFD700" size={22} />
        </TouchableOpacity>
      </View>
    </View>
  );
};
