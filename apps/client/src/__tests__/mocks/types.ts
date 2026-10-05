import React from "react";
import { ViewStyle, TextStyle, ImageStyle } from "react-native";
import { NavigationProp, RouteProp } from "@react-navigation/native";
import { RootStackParamList, TabParamList } from "../../navigation/types";
import { Gesture } from "react-native-gesture-handler";

/**
 * Types de mock pour les tests
 * Centralise tous les types utilisés dans les mocks pour éviter l'usage de 'any'
 */

// Types React Navigation
export type MockNavigationProp<T extends keyof RootStackParamList> =
  NavigationProp<RootStackParamList, T>;

export type MockRouteProp<T extends keyof RootStackParamList> = RouteProp<
  RootStackParamList,
  T
>;

export type MockTabNavigationProp<T extends keyof TabParamList> =
  NavigationProp<TabParamList, T>;

// Types pour les composants React Navigation
export interface MockNavigationState {
  index: number;
  routes: Array<{
    key: string;
    name: string;
    params?: Record<string, unknown>;
  }>;
}

export interface MockRouteDescriptor {
  key: string;
  options: {
    tabBarIcon?: (props: {
      focused: boolean;
      color: string;
      size: number;
    }) => React.ReactNode;
    tabBarAccessibilityLabel?: string;
    tabBarTestID?: string;
  };
}

export interface MockTabBarProps {
  state: MockNavigationState;
  descriptors: Record<string, MockRouteDescriptor>;
  navigation: MockNavigationProp<keyof RootStackParamList>;
}

export interface MockTabButtonProps {
  route: MockNavigationState["routes"][0];
  index: number;
  descriptors: Record<string, MockRouteDescriptor>;
  state: MockNavigationState;
  navigation: MockNavigationProp<keyof RootStackParamList>;
  currentTheme: {
    primary: string;
    textSecondary: string;
  };
  isLightMode: boolean;
  tabWidth: number;
  onPressOverride: (index: number, routeName: string, routeKey: string) => void;
}

// Types pour les composants React Native
export interface MockViewProps {
  children?: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  testID?: string;
  [key: string]: unknown;
}

export interface MockTextProps {
  children?: React.ReactNode;
  style?: TextStyle | TextStyle[];
  testID?: string;
  numberOfLines?: number;
  [key: string]: unknown;
}

export interface MockIconProps {
  size?: number;
  color?: string;
  [key: string]: unknown;
}

// Types pour Alert
export interface MockAlertButton {
  text?: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
}

export type MockAlertButtons = MockAlertButton[];

// Types pour FluidSegmentedTab
export interface MockSegmentedTabOption {
  value: string;
  label: string;
  text?: string;
}

export interface MockFluidSegmentedTabProps {
  options: MockSegmentedTabOption[];
  onChange: (value: string) => void;
  activeValue?: string;
  testID?: string;
}

// Types pour GooglePlacesAutocomplete
export interface MockGooglePlacesAutocompleteProps {
  textInputProps?: Record<string, unknown>;
  [key: string]: unknown;
}

// Types pour DateTimePicker
export interface MockDateTimePickerProps {
  value?: Date;
  mode?: "date" | "time" | "datetime";
  onChange?: (
    event: { nativeEvent: { timestamp: number } },
    selectedDate?: Date,
  ) => void;
  [key: string]: unknown;
}

// Types pour DraggableFlatList
export interface MockDraggableFlatListProps<T> {
  data: T[];
  renderItem: (params: {
    item: T;
    drag: () => void;
    isActive: boolean;
  }) => React.ReactNode;
  ListFooterComponent?: React.ReactNode;
  [key: string]: unknown;
}

export interface MockScaleDecoratorProps {
  children: React.ReactNode;
}

// Types pour les hooks de navigation
export type MockUseFocusEffectCallback = (
  callback: () => void | (() => void),
) => void;

export type MockUseCodeScannerConfig = {
  onCodeScanned: (data: { code: string }) => void;
  [key: string]: unknown;
};

// Types pour les composants de navigation
export interface MockNavigatorProps {
  children: React.ReactNode;
}

export interface MockScreenProps {
  name: string;
  component: React.ComponentType<object>;
  _name?: string; // Pour les mocks qui ignorent le nom
}

export interface MockNavigationContainerProps {
  children: React.ReactNode;
}

// Types pour les composants de thème
export interface MockThemeProviderProps {
  children: React.ReactNode;
}

// Types pour les gestes
export type MockGesture = ReturnType<typeof Gesture.Pan>;

// Types pour les props de composants génériques
export interface MockComponentProps {
  children?: React.ReactNode;
  testID?: string;
  [key: string]: unknown;
}

// Types pour les styles
export type MockStyleProp = ViewStyle | TextStyle | ImageStyle;

// Types pour les callbacks de test
export type MockTestPropsCreator<T> = (props: Partial<T>) => T;

// Types pour les handlers d'événements
export type MockEventHandler<T = unknown> = (event: T) => void;

// Types pour les notifications
export interface MockNotificationMessage {
  data?: Record<string, unknown>;
  notification?: {
    title?: string;
    body?: string;
  };
  [key: string]: unknown;
}

// Types pour les erreurs
export interface MockError {
  message: string;
  code?: string;
  [key: string]: unknown;
}
