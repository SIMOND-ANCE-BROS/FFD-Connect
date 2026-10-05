import type { ReactNode } from "react";
import type { StyleProp, ViewProps, ViewStyle } from "react-native";
import { View } from "react-native";

interface LinearGradientProps extends Omit<ViewProps, "style"> {
  colors: string[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  locations?: number[];
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

const LinearGradient = ({
  colors,
  start,
  end,
  locations: _locations,
  children,
  style,
  ...props
}: LinearGradientProps) => {
  // Simple web implementation using inline styles for gradient
  // Note: start/end mapping to CSS angles is non-trivial, so we default to to-bottom
  // or just use the first color as fallback.

  let backgroundStyle = {};
  if (colors.length >= 2) {
    const colorString = colors.join(", ");
    // Basic vertical gradient
    backgroundStyle = {
      backgroundImage: `linear-gradient(to bottom, ${colorString})`,
    };

    // If horizontal (start={x:0, y:0} end={x:1, y:0})
    if (start && end && start.x !== end.x && start.y === end.y) {
      backgroundStyle = {
        backgroundImage: `linear-gradient(to right, ${colorString})`,
      };
    }
  }

  return (
    <View style={[style, backgroundStyle]} {...props}>
      {children}
    </View>
  );
};

export default LinearGradient;
