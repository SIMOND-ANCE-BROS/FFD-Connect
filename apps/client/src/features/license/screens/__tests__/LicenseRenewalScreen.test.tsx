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
});
