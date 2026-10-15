import { act, fireEvent, render } from "@testing-library/react-native";
import React from "react";

import { useTheme, ThemeContextType } from "../../../../context/ThemeContext";
import api from "../../../../services/api";
import { ProfileScreen } from "../ProfileScreen";
import { preloadReactNative } from "../../../../__tests__/mocks/preloadReactNative";

// Parental consent banner (#61): own suite; reads the server state.
jest.mock("../../../parental-consent/ParentalConsentBanner", () => ({
  ParentalConsentBanner: () => null,
}));
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
  Hourglass: () => null,
  IdCard: () => null,
}));
jest.mock("../../../license/components/LicenseExpiryBanner", () => ({
  LicenseExpiryBanner: () => null,
}));
const mockRenewalPending = jest.fn(() => false);
const mockRefreshRenewalStatus = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../license/hooks/useRenewalPending", () => ({
  useRenewalPending: () => mockRenewalPending(),
  useRefreshRenewalStatusIfPending: () => mockRefreshRenewalStatus,
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

// One-off react-native module loading, out of the first test's budget
// (flaky under load otherwise, #546).
preloadReactNative("ScrollView");

describe("ProfileScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRenewalPending.mockReturnValue(false);
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

  it("says a renewal request is being checked (#268)", async () => {
    mockRenewalPending.mockReturnValue(true);
    mockGet.mockImplementation((url: string) =>
      url === "/licenses/my"
        ? Promise.resolve({ data: null })
        : Promise.resolve({ data: { results: [] } }),
    );

    const { findByText } = await render(
      <ProfileScreen navigation={mockNavigation} route={route} />,
    );

    await fireEvent.press(
      await findByText("Demande de renouvellement en cours de vérification"),
    );
    const { navigate } = mockNavigation as unknown as { navigate: jest.Mock };
    expect(navigate).toHaveBeenCalledWith("LicenseRenewal");
  });

  it("re-reads a pending renewal status on pull-to-refresh (#268)", async () => {
    mockGet.mockImplementation((url: string) =>
      url === "/licenses/my"
        ? Promise.resolve({ data: null })
        : Promise.resolve({ data: { results: [] } }),
    );

    const { findByText, getByTestId } = await render(
      <ProfileScreen navigation={mockNavigation} route={route} />,
    );
    await findByText("Aucune licence associée");
    expect(mockRefreshRenewalStatus).not.toHaveBeenCalled();

    const refreshControl = getByTestId("profile-scroll").props
      .refreshControl as React.ReactElement<{ onRefresh: () => void }>;
    await act(async () => {
      refreshControl.props.onRefresh();
    });
    expect(mockRefreshRenewalStatus).toHaveBeenCalledTimes(1);
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

  it("shows the discipline actually practised over the stored licence category (#552)", async () => {
    mockGet.mockImplementation((url: string) =>
      url === "/licenses/my"
        ? Promise.resolve({
            data: {
              number: "FFD-1",
              validUntil: "2026-12-31T00:00:00Z",
              category: "Ten Dance",
              discipline: "Latin",
              clubName: "CVDS",
            },
          })
        : Promise.resolve({ data: { results: [] } }),
    );

    const { findByText, queryByText } = await render(
      <ProfileScreen navigation={mockNavigation} route={route} />,
    );

    expect(await findByText(/Latines/)).toBeTruthy();
    expect(queryByText(/10 danses/)).toBeNull();
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
