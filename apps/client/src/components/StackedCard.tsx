import React, { useEffect } from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  Easing,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

interface StackedCardProps {
  index: number;
  isActive: boolean;
  pullY: SharedValue<number>;
  pullGesture: ReturnType<typeof Gesture.Pan>;
  isPullable: boolean;
  onPress: () => void;
  children: React.ReactNode;
  testID?: string;
}

export const StackedCard: React.FC<StackedCardProps> = ({
  index,
  isActive,
  pullY,
  pullGesture,
  isPullable,
  onPress,
  children,
  testID,
}) => {
  const top = useSharedValue(isActive ? 85 : 0);
  const scale = useSharedValue(isActive ? 1 : 0.96);

  useEffect(() => {
    const config = { duration: 350, easing: Easing.inOut(Easing.quad) };
    top.value = withTiming(isActive ? 85 : 0, config);
    scale.value = withTiming(isActive ? 1 : 0.96, config);
  }, [isActive, top, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    zIndex: isActive ? 100 : index,
    transform: [
      { translateY: isPullable ? pullY.value : 0 },
      { scale: scale.value },
    ],
    top: top.value,
    opacity: 1,
  }));

  const content = (
    <Animated.View
      testID={testID}
      style={[
        isActive ? styles.stackedActive : styles.stackedInactive,
        animatedStyle,
      ]}
    >
      <TouchableOpacity
        accessibilityRole="button"
        activeOpacity={1}
        onPress={onPress}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );

  if (isPullable) {
    return <GestureDetector gesture={pullGesture}>{content}</GestureDetector>;
  }

  return content;
};

const styles = StyleSheet.create({
  stackedActive: {
    position: "relative",
    width: "100%",
    marginBottom: 10,
  },
  stackedInactive: {
    position: "absolute",
    left: 20,
    right: 20,
  },
});
