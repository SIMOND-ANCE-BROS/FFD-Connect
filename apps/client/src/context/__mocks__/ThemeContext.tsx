import React, { PropsWithChildren } from "react";

export const mockTheme = {
  background: "#ffffff",
  surface: "#f2f2f2",
  text: "#111111",
  textSecondary: "#666666",
  primary: "#3b82f6",
  secondary: "#22c55e",
  border: "#e5e7eb",
  success: "#10b981",
  error: "#ef4444",
  warning: "#f59e0b",
  info: "#3b82f6",
  isDark: false,
  colors: {
    primary: "#3b82f6",
    background: "#ffffff",
    card: "#f2f2f2",
    text: "#111111",
    border: "#e5e7eb",
    notification: "#ef4444",
  },
};

export const ThemeProvider = ({ children }: PropsWithChildren) => (
  <>{children}</>
);

export const useTheme = jest.fn(() => ({
  theme: mockTheme,
  isDark: false,
  toggleTheme: jest.fn(),
  animationsEnabled: false,
}));
