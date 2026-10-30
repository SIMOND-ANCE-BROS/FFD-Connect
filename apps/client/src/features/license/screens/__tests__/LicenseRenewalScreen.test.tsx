import { render } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";
import { useTheme } from "../../../../context/ThemeContext";
import { isSensitiveScreenShown } from "../../../../utils/sentryPrivacy";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { useLicenseRenewalLogic } from "../../hooks/useLicenseRenewalLogic";
import { LicenseRenewalScreen } from "../LicenseRenewalScreen";
import { preloadReactNative } from "../../../../__tests__/mocks/preloadReactNative";

// Parental consent banner (#61): own suite; reads the server state.
jest.mock("../../../parental-consent/ParentalConsentBanner", () => ({
  ParentalConsentBanner: () => null,
}));
jest.mock("../../hooks/useLicenseRenewalLogic");
jest.mock("../../../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useTheme: jest.fn(),
}));

// One-off react-native module loading, out of the first test's budget
// (#862). The first render (loading state) reads these lazy getters: cold
// and under full-suite load they cost ~25 s (TouchableOpacity 12.6 s,
// ScrollView 4.5 s, Text 3.2 s), so the first test timed out while the
// others took < 110 ms.
preloadReactNative(
  "View",
  "Text",
  "ScrollView",
  "TouchableOpacity",
  "ActivityIndicator",
);

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

describe("LicenseRenewalScreen — decision shown to the licensee (#268)", () => {
  const baseLogic = () => ({
    request: null,
    loading: false,
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
  });

  const renderScreen = () =>
    render(
      <LicenseRenewalScreen
        {...createMockScreenProps("LicenseRenewal", undefined)}
      />,
    );

  it("shows the refusal reason and the federation's comment", async () => {
    (useLicenseRenewalLogic as jest.Mock).mockReturnValue({
      ...baseLogic(),
      request: {
        id: "req-1",
        status: "REJECTED",
        documents: [],
        rejectionReason: "ILLEGIBLE",
        reviewComment: "Merci de reprendre la photo en pleine lumière.",
      },
      step: "rejected",
    });

    const { getByText } = await renderScreen();

    expect(getByText("Motif : Document illisible")).toBeTruthy();
    expect(getByText("Commentaire de la fédération")).toBeTruthy();
    expect(
      getByText("Merci de reprendre la photo en pleine lumière."),
    ).toBeTruthy();
    expect(getByText("Nouvelle demande")).toBeTruthy();
  });

  it("shows the reason alone when the federation left no comment", async () => {
    (useLicenseRenewalLogic as jest.Mock).mockReturnValue({
      ...baseLogic(),
      request: {
        id: "req-1",
        status: "REJECTED",
        documents: [],
        rejectionReason: "CERTIFICATE_TOO_OLD",
        reviewComment: null,
      },
      step: "rejected",
    });

    const { getByText, queryByText } = await renderScreen();

    expect(getByText("Motif : Certificat trop ancien")).toBeTruthy();
    expect(queryByText("Commentaire de la fédération")).toBeNull();
  });

  it("keeps the generic text for a refusal without a reason (older request)", async () => {
    (useLicenseRenewalLogic as jest.Mock).mockReturnValue({
      ...baseLogic(),
      request: { id: "req-1", status: "REJECTED", documents: [] },
      step: "rejected",
    });

    const { getByText, queryByText } = await renderScreen();

    expect(getByText(/n’a pas pu être validée/)).toBeTruthy();
    expect(queryByText(/^Motif :/)).toBeNull();
  });

  it("labels the OCR reading as indicative only", async () => {
    const medical = {
      id: "d1",
      type: "MEDICAL_CERTIFICATE",
      ocrData: { isApte: false },
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    (useLicenseRenewalLogic as jest.Mock).mockReturnValue({
      ...baseLogic(),
      request: { id: "req-1", status: "DRAFT", documents: [medical] },
      getDoc: (type: string) =>
        type === "MEDICAL_CERTIFICATE" ? medical : undefined,
    });

    const { getByText } = await renderScreen();

    expect(getByText("Lu automatiquement — à titre indicatif")).toBeTruthy();
  });

  it("shows a fit reading as « Apte à la pratique »", async () => {
    const medical = {
      id: "d1",
      type: "MEDICAL_CERTIFICATE",
      ocrData: { isApte: true },
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    (useLicenseRenewalLogic as jest.Mock).mockReturnValue({
      ...baseLogic(),
      request: { id: "req-1", status: "DRAFT", documents: [medical] },
      getDoc: (type: string) =>
        type === "MEDICAL_CERTIFICATE" ? medical : undefined,
    });

    const { getByText, queryByText } = await renderScreen();

    expect(getByText("Apte à la pratique")).toBeTruthy();
    expect(queryByText(/contre-indication/)).toBeNull();
  });

  it("words a contraindication read by the OCR as a hint, apart from a fit reading", async () => {
    const medical = {
      id: "d1",
      type: "MEDICAL_CERTIFICATE",
      ocrData: { isApte: false },
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    (useLicenseRenewalLogic as jest.Mock).mockReturnValue({
      ...baseLogic(),
      request: { id: "req-1", status: "DRAFT", documents: [medical] },
      getDoc: (type: string) =>
        type === "MEDICAL_CERTIFICATE" ? medical : undefined,
    });

    const { getByText, queryByText } = await renderScreen();

    expect(
      getByText(
        "Le certificat semble mentionner une contre-indication à la pratique.",
      ),
    ).toBeTruthy();
    expect(queryByText("Non apte")).toBeNull();
    expect(queryByText("Apte à la pratique")).toBeNull();
  });
});

describe("LicenseRenewalScreen — submit button contrast (#22)", () => {
  beforeEach(() => {
    (useTheme as jest.Mock).mockReturnValue({
      theme: {
        background: "#fff",
        surface: "#f2f2f2",
        text: "#111",
        textSecondary: "#666",
        primary: "#3b82f6",
        primaryFill: "#1d4ed8",
        onPrimary: "#ffffff",
        disabledFill: "#e2e8f0",
        onDisabled: "#475569",
        border: "#e5e7eb",
        danger: "#ef4444",
      },
      isDark: false,
    });
  });

  const renderWith = async (canSubmit: boolean) => {
    (useLicenseRenewalLogic as jest.Mock).mockReturnValue({
      request: { id: "req-1", status: "DRAFT", documents: [] },
      loading: false,
      uploadingType: null,
      submitting: false,
      canSubmit,
      step: "documents",
      getDoc: jest.fn(),
      loadRenewal: jest.fn().mockResolvedValue(undefined),
      startOrGetDraft: jest.fn(),
      pickAndUploadDocument: jest.fn(),
      submit: jest.fn().mockResolvedValue(undefined),
    });
    const utils = await render(
      <LicenseRenewalScreen
        {...createMockScreenProps("LicenseRenewal", undefined)}
      />,
    );
    const button = utils.getByTestId("license-renewal-submit");
    return {
      state: button.props.accessibilityState,
      fill: (StyleSheet.flatten(button.props.style) as ViewStyle)
        .backgroundColor,
      label: (
        StyleSheet.flatten(
          utils.getByText("Soumettre la demande").props.style,
        ) as TextStyle
      ).color,
    };
  };

  it("uses the disabled token pair while documents are missing", async () => {
    const { state, fill, label } = await renderWith(false);
    expect(state).toMatchObject({ disabled: true });
    expect(fill).toBe("#e2e8f0");
    expect(label).toBe("#475569");
  });

  it("uses the primary pair once the request can be submitted", async () => {
    const { state, fill, label } = await renderWith(true);
    expect(state).toMatchObject({ disabled: false });
    expect(fill).toBe("#1d4ed8");
    expect(label).toBe("#ffffff");
  });
});
