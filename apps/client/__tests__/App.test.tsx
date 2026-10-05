/**
 * @format
 */

import React, { PropsWithChildren } from "react";
import { render } from "@testing-library/react-native";
import App from "../App";

jest.mock("../src/features/auth/context/AuthContext", () => ({
  AuthProvider: ({ children }: PropsWithChildren) => children,
  useAuthRepository: jest.fn(() => ({
    getAuthConfig: jest.fn().mockResolvedValue({}),
    saveAuthConfig: jest.fn(),
    login: jest.fn(),
    loginAsGuest: jest.fn(),
    logout: jest.fn(),
  })),
  UserRole: {},
}));
jest.mock("../src/features/player/context/TrackContext", () => ({
  TrackProvider: ({ children }: PropsWithChildren) => children,
}));
jest.mock("../src/features/player/context/LibraryContext", () => ({
  LibraryProvider: ({ children }: PropsWithChildren) => children,
}));
jest.mock("../src/features/player/context/PlayerContext", () => ({
  PlayerProvider: ({ children }: PropsWithChildren) => children,
}));
jest.mock("../src/features/competitions/context/CompetitionContext", () => ({
  CompetitionProvider: ({ children }: PropsWithChildren) => children,
}));
jest.mock("../src/features/performance/context/PerformanceContext", () => ({
  PerformanceProvider: ({ children }: PropsWithChildren) => children,
}));
jest.mock("../src/context/ThemeContext", () => ({
  ThemeProvider: ({ children }: PropsWithChildren) => children,
  useTheme: () => ({
    theme: { statusBarStyle: "default", background: "white" },
    isDark: false,
  }),
}));
jest.mock("../src/navigation/AppNavigator", () => ({
  AppNavigator: () => null,
}));
jest.mock("../src/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: PropsWithChildren) => children,
}));

const mockSetupPushListeners = jest.fn();
jest.mock("../src/features/settings/services/pushRegistration", () => ({
  setupPushListeners: () => {
    mockSetupPushListeners();
  },
  registerDeviceTokenForPush: jest.fn().mockResolvedValue(undefined),
}));

test("renders correctly", async () => {
  await render(<App />);
});

test("wires the foreground push listeners on mount (#775)", async () => {
  mockSetupPushListeners.mockClear();
  await render(<App />);
  expect(mockSetupPushListeners).toHaveBeenCalledTimes(1);
});
