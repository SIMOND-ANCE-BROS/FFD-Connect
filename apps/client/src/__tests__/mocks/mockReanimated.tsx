import React from "react";
import { Text, View, ViewProps, TextProps } from "react-native";

export const useSharedValue = jest.fn(() => ({ value: 0 }));
export const useAnimatedStyle = jest.fn(() => ({}));
export const withTiming = jest.fn();
export const withSpring = jest.fn();
export const runOnJS = jest.fn(
  <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
);
export const interpolate = jest.fn();
export const Extrapolation = { CLAMP: "CLAMP" };
export const ReduceMotion = {
  System: "system",
  Always: "always",
  Never: "never",
};
export const SharedValue = {};
export const Easing = {
  inOut: jest.fn(),
  quad: jest.fn(),
};
export const FadeIn = { duration: jest.fn().mockReturnThis() };
export const FadeInDown = {
  delay: jest.fn().mockReturnThis(),
  duration: jest.fn().mockReturnThis(),
  springify: jest.fn().mockReturnThis(),
};
export const FadeInUp = {
  delay: jest.fn().mockReturnThis(),
  duration: jest.fn().mockReturnThis(),
  springify: jest.fn().mockReturnThis(),
};
export const Layout = { springify: jest.fn().mockReturnThis() };

// Components need to be exported carefully
export const createAnimatedComponent = <T extends React.ComponentType<object>>(
  c: T,
): T => c;

const MockView = ({ children, ...props }: ViewProps) => (
  <View {...props}>{children}</View>
);
const MockText = ({ children, ...props }: TextProps) => (
  <Text {...props}>{children}</Text>
);

const ReanimatedMock = {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
  ReduceMotion,
  SharedValue,
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  Layout,
  createAnimatedComponent,
  View: MockView,
  Text: MockText,
  default: {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    withSpring,
    runOnJS,
    interpolate,
    Extrapolation,
    ReduceMotion,
    SharedValue,
    Easing,
    FadeIn,
    FadeInDown,
    FadeInUp,
    Layout,
    createAnimatedComponent,
    View: MockView,
    Text: MockText,
  },
};

export default ReanimatedMock;
