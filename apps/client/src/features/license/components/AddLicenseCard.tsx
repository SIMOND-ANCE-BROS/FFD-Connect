import { Plus } from "lucide-react-native";
import React, { useRef } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated";
import { AppText } from "../../../components/AppText";

import { AppTheme } from "../../../context/ThemeContext";

interface AddLicenseCardProps {
  theme: AppTheme;
  style?: ViewStyle | ViewStyle[];
  pullY: SharedValue<number>;
  onPlusLayout?: (layout: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
}

export const AddLicenseCard: React.FC<AddLicenseCardProps> = ({
  theme,
  style,
  pullY,
  onPlusLayout,
}) => {
  const iconRef = useRef<View>(null);
  const animatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      pullY.value,
      [0, 100],
      [1, 1.5],
      Extrapolation.CLAMP,
    );
    const rotate = interpolate(
      pullY.value,
      [0, 100],
      [0, 90],
      Extrapolation.CLAMP,
    );
    return {
      transform: [{ scale }, { rotate: `${rotate}deg` }],
    };
  });

  return (
    <View style={[styles.ghostCard, { backgroundColor: theme.surface }, style]}>
      <View
        style={[
          styles.ghostHeader,
          theme.dark ? styles.ghostHeaderDark : styles.ghostHeaderLight,
        ]}
      >
        <Animated.View
          ref={iconRef}
          onLayout={() => {
            if (iconRef.current?.measureInWindow) {
              iconRef.current.measureInWindow((x, y, width, height) => {
                onPlusLayout?.({ x, y, width, height });
              });
            }
          }}
          style={[
            styles.ghostIconBox,
            { backgroundColor: theme.colors.ffdBlue },
            animatedStyle,
          ]}
        >
          <Plus size={24} color="white" />
        </Animated.View>
        <View>
          <AppText variant="h3" style={{ color: theme.text }}>
            Ajouter la licence WDSF
          </AppText>
          <AppText variant="caption" style={{ color: theme.textSecondary }}>
            Tirer pour ajouter
          </AppText>
        </View>
      </View>

      <View style={styles.ghostBody}>
        <AppText
          variant="h1"
          style={[styles.ghostBodyText, { color: theme.text }]}
        >
          WDSF
        </AppText>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  ghostCard: {
    width: "100%",
    height: 280,
    borderRadius: 16,
    overflow: "hidden",
  },
  ghostHeader: {
    height: 90,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  ghostIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 15,
  },
  ghostBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.1,
  },
  ghostBodyText: {
    fontSize: 80,
  },
  ghostHeaderLight: {
    backgroundColor: "#E2E8F0",
  },
  ghostHeaderDark: {
    backgroundColor: "#334155",
  },
});
