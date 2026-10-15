import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { createMockScreenProps } from "../../../utils/testUtils";
import { ParentalConsentScreen } from "../ParentalConsentScreen";
import { useParentalConsent } from "../useParentalConsent";

jest.mock("../useParentalConsent");
jest.mock("lucide-react-native", () => ({
  Mail: () => null,
  ShieldCheck: () => null,
}));
jest.mock("../../../context/ThemeContext", () => ({
  useTheme: () =>
    (
      require("../../../__tests__/mocks/mockTheme") as typeof import("../../../__tests__/mocks/mockTheme")
    ).mockUseTheme(),
}));
jest.mock("../../../components/AppText");
jest.mock("../../../components/AppButton");
jest.mock("../../../components/PinnedHeader", () => ({
  PinnedHeader: () => null,
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockHook = useParentalConsent as jest.Mock;

function hookValue(overrides: Record<string, unknown> = {}) {
  return {
    consent: { state: "REQUIRED" },
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    request: { mutate: jest.fn(), isPending: false },
    ...overrides,
  };
}

const renderScreen = () =>
  render(
    <ParentalConsentScreen
      {...createMockScreenProps("ParentalConsent", undefined)}
    />,
  );

describe("ParentalConsentScreen (#61)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows a loader while the state loads", async () => {
    mockHook.mockReturnValue(hookValue({ isLoading: true }));
    const { getByTestId } = await renderScreen();
    expect(getByTestId("parental-consent-loading")).toBeTruthy();
  });

  it("offers a retry when the state cannot be read", async () => {
    const value = hookValue({ consent: undefined, error: new Error("x") });
    mockHook.mockReturnValue(value);
    const { getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId("parental-consent-retry"));
    expect(value.refetch).toHaveBeenCalled();
  });

  it("refuses an invalid address without calling the server", async () => {
    const value = hookValue();
    mockHook.mockReturnValue(value);
    const { getByTestId, findByTestId } = await renderScreen();
    await fireEvent.changeText(
      getByTestId("parental-consent-email-input"),
      "not-an-email",
    );
    await fireEvent.press(getByTestId("parental-consent-submit"));
    expect(value.request.mutate).not.toHaveBeenCalled();
    expect(
      (await findByTestId("parental-consent-feedback")).props.children,
    ).toBe("Saisissez une adresse e-mail valide.");
  });

  it("sends the request and confirms it", async () => {
    const value = hookValue();
    value.request.mutate.mockImplementation(
      (_email: string, handlers: { onSuccess: () => void }) =>
        handlers.onSuccess(),
    );
    mockHook.mockReturnValue(value);
    const { getByTestId, findByTestId } = await renderScreen();
    await fireEvent.changeText(
      getByTestId("parental-consent-email-input"),
      " parent@example.fr ",
    );
    await fireEvent.press(getByTestId("parental-consent-submit"));
    expect(value.request.mutate).toHaveBeenCalledWith(
      "parent@example.fr",
      expect.any(Object),
    );
    expect(
      (await findByTestId("parental-consent-feedback")).props.children,
    ).toContain("Demande envoyée");
  });

  it("shows the server's refusal", async () => {
    const value = hookValue();
    value.request.mutate.mockImplementation(
      (_email: string, handlers: { onError: (e: Error) => void }) =>
        handlers.onError(new Error("Déjà donné")),
    );
    mockHook.mockReturnValue(value);
    const { getByTestId, findByTestId } = await renderScreen();
    await fireEvent.changeText(
      getByTestId("parental-consent-email-input"),
      "parent@example.fr",
    );
    await fireEvent.press(getByTestId("parental-consent-submit"));
    expect(
      (await findByTestId("parental-consent-feedback")).props.children,
    ).toBe("Déjà donné");
  });

  it("offers to re-send while pending", async () => {
    mockHook.mockReturnValue(
      hookValue({
        consent: { state: "PENDING", parentEmailMasked: "p***@e***.fr" },
      }),
    );
    const { getByTestId } = await renderScreen();
    expect(getByTestId("parental-consent-message").props.children).toContain(
      "p***@e***.fr",
    );
    expect(getByTestId("parental-consent-submit")).toBeTruthy();
  });

  it("offers nothing to send once granted", async () => {
    mockHook.mockReturnValue(hookValue({ consent: { state: "GRANTED" } }));
    const { queryByTestId, getByTestId } = await renderScreen();
    expect(queryByTestId("parental-consent-email-input")).toBeNull();
    expect(getByTestId("parental-consent-title").props.children).toBe(
      "Accord parental donné",
    );
  });
});
