import React from "react";
import { Pressable, Text } from "react-native";

export const AppButton = ({
  title,
  onPress,
  testID,
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  testID?: string;
  loading?: boolean;
  disabled?: boolean;
}) => (
  <Pressable
    accessibilityRole="button"
    onPress={onPress}
    testID={testID ?? `btn-${title}`}
    disabled={disabled}
  >
    <Text>{loading ? "Loading..." : title}</Text>
  </Pressable>
);
