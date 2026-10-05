import React from "react";

export const mockTheme = {
  theme: {
    background: "#ffffff",
    surface: "#f2f2f2",
    text: "#111111",
    textSecondary: "#666666",
    primary: "#3b82f6",
    secondary: "#E0E0E0",
    border: "#e5e7eb",
    danger: "#ef4444",
    success: "#22c55e",
    warning: "#f59e0b",
    info: "#3b82f6",
    colors: {
      primary: "#3b82f6",
      background: "#ffffff",
      surface: "#f2f2f2",
      text: "#111111",
      textSecondary: "#666666",
      border: "#e5e7eb",
      error: "#ef4444",
      success: "#22c55e",
      warning: "#f59e0b",
      info: "#3b82f6",
      card: "#ffffff",
      notification: "#ef4444",
      ffdBlue: "#0055a4",
      slate100: "#F1F5F9",
      slate800: "#1E293B",
    },
    spacing: { s: 4, m: 8, l: 16, xl: 24, xs: 2, xxl: 32 },
    roundness: 8,
    textVariants: {
      h1: { fontSize: 24 },
      h2: { fontSize: 20 },
      body: { fontSize: 16 },
      caption: { fontSize: 12 },
      button: { fontSize: 14 },
    },
    animation: {
      scale: 1,
    },
    statusBarStyle: "dark-content",
  },
  isDark: false,
};

export const mockUseTheme = jest.fn(() => mockTheme);

export const MockThemeProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => children;
