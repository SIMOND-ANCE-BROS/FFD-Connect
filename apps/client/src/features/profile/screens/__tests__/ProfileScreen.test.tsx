import { act, fireEvent, render } from "@testing-library/react-native";
import React from "react";

import { useTheme, ThemeContextType } from "../../../../context/ThemeContext";
import api from "../../../../services/api";
import {
  useRenewalStatusRefresh,
  useRenewalUnderReview,
} from "../../../license/hooks/useMyRenewalStatus";
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
  Hourglass: () => null,
}));
jest.mock("../../../license/components/LicenseExpiryBanner", () => ({
  LicenseExpiryBanner: () => {
    const { View } = require("react-native");
    return <View testID="license-expiry-banner" />;
  },
}));
jest.mock("../../../license/hooks/useMyRenewalStatus", () => ({
  useRenewalUnderReview: jest.fn(() => false),
  useRenewalStatusRefresh: jest.fn(() =>
    jest.fn().mockResolvedValue(undefined),
  ),
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

  it("shows « en cours de vérification » instead of the expiry banner while a renewal is PENDING (#268)", async () => {
    (useRenewalUnderReview as jest.Mock).mockReturnValue(true);
    mockGet.mockImplementation((url: string) =>
      url === "/licenses/my"
        ? Promise.resolve({ data: null })
        : Promise.resolve({ data: { results: [] } }),
    );

    const { findByText, getByTestId, queryByTestId } = await render(
      <ProfileScreen navigation={mockNavigation} route={route} />,
    );

    expect(
      await findByText("Demande de renouvellement en cours de vérification"),
    ).toBeTruthy();
    expect(queryByTestId("license-expiry-banner")).toBeNull();

    await fireEvent.press(getByTestId("renewal-under-review-banner"));
    const { navigate } = mockNavigation as unknown as { navigate: jest.Mock };
    expect(navigate).toHaveBeenCalledWith("LicenseRenewal");
  });

  it("re-reads the renewal status on pull-to-refresh (#268)", async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    (useRenewalStatusRefresh as jest.Mock).mockReturnValue(refresh);
    mockGet.mockImplementation((url: string) =>
      url === "/licenses/my"
        ? Promise.resolve({ data: null })
        : Promise.resolve({ data: { results: [] } }),
    );

    const { findByText, getByTestId } = await render(
      <ProfileScreen navigation={mockNavigation} route={route} />,
    );
    await findByText("Aucune licence associée");

    const refreshControl = getByTestId("profile-scroll").props
      .refreshControl as React.ReactElement<{ onRefresh: () => void }>;
    await act(async () => {
      refreshControl.props.onRefresh();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the expiry banner without a pending renewal", async () => {
    (useRenewalUnderReview as jest.Mock).mockReturnValue(false);
    mockGet.mockImplementation((url: string) =>
      url === "/licenses/my"
        ? Promise.resolve({ data: null })
        : Promise.resolve({ data: { results: [] } }),
    );

    const { findByTestId, queryByTestId } = await render(
      <ProfileScreen navigation={mockNavigation} route={route} />,
    );

    expect(await findByTestId("license-expiry-banner")).toBeTruthy();
    expect(queryByTestId("renewal-under-review-banner")).toBeNull();
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

  it("shows the competition level of each discipline", async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === "/users/me") {
        return Promise.resolve({
          data: {
            competitionLevelLatin: "Avancé",
            competitionLevelStandard: "Débutant",
            competitionLevel: "Intermédiaire",
          },
        });
      }
      return url === "/licenses/my"
        ? Promise.resolve({ data: null })
        : Promise.resolve({ data: { results: [] } });
    });

    const { findByText } = await render(
      <ProfileScreen navigation={mockNavigation} route={route} />,
    );

    expect(await findByText("Niveau de compétition")).toBeTruthy();
    expect(
      await findByText("Latines : Avancé · Standards : Débutant"),
    ).toBeTruthy();
  });

  it("falls back to the legacy single level, and hides the row without any level", async () => {
    mockGet.mockImplementation((url: string) =>
      url === "/users/me"
        ? Promise.resolve({ data: { competitionLevel: "Avancé" } })
        : Promise.resolve({
            data: url === "/licenses/my" ? null : { results: [] },
          }),
    );
    const first = await render(
      <ProfileScreen navigation={mockNavigation} route={route} />,
    );
    expect(await first.findByText("Avancé")).toBeTruthy();
    await first.unmount();

    mockGet.mockImplementation((url: string) =>
      url === "/users/me"
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({
            data: url === "/licenses/my" ? null : { results: [] },
          }),
    );
    const second = await render(
      <ProfileScreen navigation={mockNavigation} route={route} />,
    );
    expect(await second.findByText("Aucune licence associée")).toBeTruthy();
    expect(second.queryByText("Niveau de compétition")).toBeNull();
  });
});
