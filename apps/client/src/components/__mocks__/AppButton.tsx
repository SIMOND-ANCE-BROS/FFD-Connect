import React from "react";
import { Pressable, Text, View } from "react-native";

export const AppButton = React.forwardRef<
  View,
  {
    title: string;
    onPress: () => void;
    testID?: string;
    loading?: boolean;
    disabled?: boolean;
    accessibilityLabel?: string;
    accessibilityHint?: string;
  }
>(function AppButton(
  {
    title,
    onPress,
    testID,
    loading,
    disabled,
    accessibilityLabel,
    accessibilityHint,
  },
  ref,
) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      onPress={onPress}
      testID={testID ?? `btn-${title}`}
      disabled={disabled}
      // Same accessible name as the real AppButton (#22).
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{
        disabled: !!disabled || !!loading,
        busy: !!loading,
      }}
    >
      <Text>{loading ? "Loading..." : title}</Text>
    </Pressable>
  );
});
