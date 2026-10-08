import { fireEvent, render } from "@testing-library/react-native";
import React from "react";

import { useTheme, ThemeContextType } from "../../../../context/ThemeContext";
import api from "../../../../services/api";
import { ProfileScreen } from "../ProfileScreen";

jest.mock("../../../../context/ThemeContext");
jest.mock("../../../../services/api", () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => {
    const { View } = require("react-native");
    return <View>{children}</View>;
  },
}));
jest.mock("lucide-react-native", () => ({
  Award: () => null,
  CreditCard: () => null,
  IdCard: () => null,
}));
jest.mock("../../../license/components/LicenseExpiryBanner", () => ({
  LicenseExpiryBanner: () => null,
}));
jest.mock("../../../../components/AppText", () => ({
  AppText: ({ children }: { children: React.ReactNode }) => {
    const { Text } = require("react-native");
    return <Text>{children}</Text>;
  },
}));
jest.mock("../../../../components/AppButton", () => ({
  AppButton: ({ title, onPress }: { title: string; onPress: () => void }) => {
    const { Text } = require("react-native");
    return <Text onPress={onPress}>{title}</Text>;
  },
}));

const mockUseTheme = useTheme as jest.MockedFunction<typeof useTheme>;
const mockGet = (api as unknown as { get: jest.Mock }).get;

const theme = {
  background: "#fff",
  surface: "#f7f7f7",
  text: "#111",
  textSecondary: "#666",
  border: "#e0e0e0",
  primary: "#004481",
  statusBarStyle: "dark-content" as const,
};

const mockNavigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
const route = { params: {} } as never;

describe("ProfileScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseTheme.mockReturnValue({ theme } as unknown as ThemeContextType);
  });

  it("shows the empty state + add-license CTA when there is no license", async () => {
    mockGet.mockImplementation((url: string) =>
      url === "/licenses/my"
        ? Promise.resolve({ data: null })
        : Promise.resolve({ data: { results: [] } }),
    );

    const { findByText, getByText, queryByText } = await render(
      <ProfileScreen navigation={mockNavigation} route={route} />,
    );

    expect(await findByText("Aucune licence associée")).toBeTruthy();
    expect(getByText("Aucun résultat pour le moment")).toBeTruthy();

    await fireEvent.press(getByText("Ajouter ma licence"));
    const { navigate } = mockNavigation as unknown as { navigate: jest.Mock };
    expect(navigate).toHaveBeenCalledWith("LicenseRenewal");
    // The check-in scanner is organizer-only (403 for licensees since #174).
    expect(navigate).not.toHaveBeenCalledWith("Scanner");
    expect(queryByText("Scanner ma licence")).toBeNull();
  });

  it("renders the license when the user has one", async () => {
    mockGet.mockImplementation((url: string) =>
      url === "/licenses/my"
        ? Promise.resolve({
            data: {
              number: "20011125-pit-ev38",
              validUntil: "2026-12-31T00:00:00Z",
              category: "Ten Dance",
              clubName: "CVDS",
            },
          })
        : Promise.resolve({ data: { results: [] } }),
    );

    const { findByText } = await render(
      <ProfileScreen navigation={mockNavigation} route={route} />,
    );

    expect(await findByText("20011125-pit-ev38")).toBeTruthy();
  });
});
