import { render } from "@testing-library/react-native";
import React, { useContext } from "react";
import { Text } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { OfflineBanner } from "../OfflineBanner";
import { TopBannersLayout } from "../TopBannersLayout";
import { useAuthStore } from "../../stores/auth.store";

jest.mock("react-native-safe-area-context", () => {
  const { createContext } = jest.requireActual<typeof import("react")>("react");
  const insets = { top: 47, bottom: 34, left: 0, right: 0 };
  return {
    SafeAreaInsetsContext: createContext(insets),
    useSafeAreaInsets: () => insets,
  };
});

jest.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { text: "#000", textSecondary: "#666", warning: "#f5a623" },
    isDark: false,
  }),
}));

jest.mock("../../features/auth/services/AuthService", () => ({
  AuthService: { stopImpersonation: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock("../../stores/auth.store", () => ({
  useAuthStore: jest.fn(),
}));

let mockIsOnline = true;
jest.mock("../../hooks/useIsOnline", () => ({
  useIsOnline: () => mockIsOnline,
}));

function setImpersonating(impersonating: boolean) {
  (useAuthStore as unknown as jest.Mock).mockImplementation(
    (sel: (s: unknown) => unknown) =>
      sel({
        impersonating,
        impersonatedName: impersonating ? "Test Club" : null,
        refreshAuth: jest.fn(),
      }),
  );
}

/** Prints the insets the app below the banners receives from the context. */
const InsetsProbe = () => {
  const insets = useContext(SafeAreaInsetsContext);
  return <Text testID="probe">{`${insets?.top}/${insets?.bottom}`}</Text>;
};

const renderLayout = () =>
  render(
    <TopBannersLayout>
      <InsetsProbe />
    </TopBannersLayout>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockIsOnline = true;
  setImpersonating(false);
});

describe("TopBannersLayout", () => {
  it("leaves the app insets untouched when no banner is shown", async () => {
    const { getByTestId, queryByTestId } = await renderLayout();
    expect(queryByTestId("impersonation-banner")).toBeNull();
    expect(queryByTestId("offline-banner")).toBeNull();
    expect(getByTestId("probe")).toHaveTextContent("47/34");
  });

  it("renders the impersonation banner in the layout flow and zeroes the app's top inset", async () => {
    setImpersonating(true);
    const { getByTestId } = await renderLayout();
    const banner = getByTestId("impersonation-banner");
    // Not an overlay: no absolute positioning over the screens' headers.
    expect(banner).not.toHaveStyle({ position: "absolute" });
    expect(banner).toHaveStyle({ paddingTop: 47 });
    // The banner absorbs the status-bar inset; headers below start at 0.
    expect(getByTestId("probe")).toHaveTextContent("0/34");
  });

  // Beta feedback: the offline banner was absolutely positioned and hid the
  // PinnedHeader titles and header buttons ("Bibliothèque", "Mes licences").
  it("renders the offline banner in the layout flow and zeroes the app's top inset", async () => {
    mockIsOnline = false;
    const { getByTestId } = await renderLayout();
    const banner = getByTestId("offline-banner");
    expect(banner).not.toHaveStyle({ position: "absolute" });
    expect(banner).toHaveStyle({ paddingTop: 47 });
    expect(getByTestId("probe")).toHaveTextContent("0/34");
  });

  it("stacks both banners: only the top one absorbs the status-bar inset", async () => {
    setImpersonating(true);
    mockIsOnline = false;
    const { getByTestId } = await renderLayout();
    expect(getByTestId("impersonation-banner")).toHaveStyle({
      paddingTop: 47,
    });
    expect(getByTestId("offline-banner")).toHaveStyle({ paddingTop: 0 });
    expect(getByTestId("probe")).toHaveTextContent("0/34");
  });

  // Review finding: each banner used to subscribe to the network on its own,
  // so "banner shown" and "insets zeroed" could drift. One subscription, here.
  it("decides the offline banner's visibility in the layout only", async () => {
    mockIsOnline = false;
    const { queryByTestId } = await render(<OfflineBanner visible={false} />);
    // The banner follows the layout's decision, not its own subscription.
    expect(queryByTestId("offline-banner")).toBeNull();
  });

  it("always renders the impersonation banner above the offline one", async () => {
    setImpersonating(true);
    mockIsOnline = false;
    const { toJSON } = await renderLayout();
    const order = JSON.stringify(toJSON()).match(
      /impersonation-banner|offline-banner/g,
    );
    expect(order).toEqual(["impersonation-banner", "offline-banner"]);
  });
});
