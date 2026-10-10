import { render } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import { useTheme } from "../../../../context/ThemeContext";
import { isSensitiveScreenShown } from "../../../../utils/sentryPrivacy";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { useLicenseRenewalLogic } from "../../hooks/useLicenseRenewalLogic";
import { LicenseRenewalScreen } from "../LicenseRenewalScreen";

jest.mock("../../hooks/useLicenseRenewalLogic");
jest.mock("../../../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useTheme: jest.fn(),
}));

describe("LicenseRenewalScreen — Sentry screenshots (#242)", () => {
  beforeEach(() => {
    (useTheme as jest.Mock).mockReturnValue({
      theme: {
        background: "#fff",
        surface: "#f2f2f2",
        text: "#111",
        textSecondary: "#666",
        primary: "#3b82f6",
        border: "#e5e7eb",
        danger: "#ef4444",
      },
      isDark: false,
    });
    (useLicenseRenewalLogic as jest.Mock).mockReturnValue({
      request: null,
      loading: true,
      uploadingType: null,
      submitting: false,
      canSubmit: false,
      step: "documents",
      getDoc: jest.fn(),
      loadRenewal: jest.fn().mockResolvedValue(undefined),
      startOrGetDraft: jest.fn(),
      pickAndUploadDocument: jest.fn(),
      submit: jest.fn(),
    });
  });

  it("flags itself as sensitive while mounted (medical certificate summary)", async () => {
    expect(isSensitiveScreenShown()).toBe(false);

    const { unmount } = await render(
      <LicenseRenewalScreen
        {...createMockScreenProps("LicenseRenewal", undefined)}
      />,
    );
    expect(isSensitiveScreenShown()).toBe(true);

    await unmount();
    expect(isSensitiveScreenShown()).toBe(false);
  });

  it("states the season rule once the renewal is approved (#250)", async () => {
    (useLicenseRenewalLogic as jest.Mock).mockReturnValue({
      ...(useLicenseRenewalLogic as jest.Mock)(),
      request: { id: "req-1", status: "APPROVED", documents: [] },
      loading: false,
      step: "approved",
    });

    const { getByText, queryByText } = await render(
      <LicenseRenewalScreen
        {...createMockScreenProps("LicenseRenewal", undefined)}
      />,
    );

    expect(getByText(/jusqu’au 31 août de la saison en cours/)).toBeTruthy();
    expect(getByText(/entre le 1er juillet et le 31 août/)).toBeTruthy();
    expect(queryByText(/de la prochaine saison/)).toBeNull();
  });
});
