import React from "react";
import { Text } from "react-native";

export const AppText = ({
  children,
  ...props
}: { children?: React.ReactNode } & Record<string, unknown>) => (
  <Text {...props}>{children}</Text>
);
