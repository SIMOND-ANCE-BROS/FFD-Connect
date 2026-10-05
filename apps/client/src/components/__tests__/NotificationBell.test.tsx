import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { NotificationBell } from "../NotificationBell";
import { useUnreadNotificationsCount } from "../../features/settings/hooks/useUnreadNotificationsCount";

jest.mock("../../features/settings/hooks/useUnreadNotificationsCount");

jest.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { text: "#000", textSecondary: "#666", danger: "#e74c3c" },
    isDark: false,
  }),
}));

const mockCount = useUnreadNotificationsCount as jest.Mock;
const theme = { text: "#000", danger: "#e74c3c" } as never;

beforeEach(() => jest.clearAllMocks());

describe("NotificationBell", () => {
  it("sans non-lus : pas de badge", async () => {
    mockCount.mockReturnValue(0);
    const { queryByTestId, getByTestId } = await render(
      <NotificationBell theme={theme} onPress={jest.fn()} />,
    );
    expect(getByTestId("notification-bell")).toBeTruthy();
    expect(queryByTestId("notification-bell-badge")).toBeNull();
  });

  it("affiche le compte de non-lus", async () => {
    mockCount.mockReturnValue(3);
    const { getByTestId, getByText } = await render(
      <NotificationBell theme={theme} onPress={jest.fn()} />,
    );
    expect(getByTestId("notification-bell-badge")).toBeTruthy();
    expect(getByText("3")).toBeTruthy();
  });

  it("plafonne l'affichage à 9+", async () => {
    mockCount.mockReturnValue(42);
    const { getByText } = await render(
      <NotificationBell theme={theme} onPress={jest.fn()} />,
    );
    expect(getByText("9+")).toBeTruthy();
  });

  it("déclenche onPress", async () => {
    mockCount.mockReturnValue(0);
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <NotificationBell theme={theme} onPress={onPress} />,
    );
    await fireEvent.press(getByTestId("notification-bell"));
    expect(onPress).toHaveBeenCalled();
  });
});
