import { fireEvent, render } from "@testing-library/react-native";
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

const mockedLogic = () => (useLicenseRenewalLogic as jest.Mock)();

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
        warning: "#f59e0b",
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

  it("shows the readable reason and the administrator's comment of a refused request (#268)", async () => {
    (useLicenseRenewalLogic as jest.Mock).mockReturnValue({
      ...mockedLogic(),
      request: {
        id: "req-1",
        status: "REJECTED",
        rejectionReason: "CERTIFICATE_TOO_OLD",
        reviewComment: "Merci de déposer un certificat de cette saison.",
        documents: [],
      },
      loading: false,
      step: "rejected",
    });

    const { getByText, queryByText } = await render(
      <LicenseRenewalScreen
        {...createMockScreenProps("LicenseRenewal", undefined)}
      />,
    );

    expect(getByText("Demande refusée")).toBeTruthy();
    expect(getByText("Motif du refus")).toBeTruthy();
    expect(getByText("Certificat médical trop ancien")).toBeTruthy();
    expect(getByText("Commentaire de l’administrateur")).toBeTruthy();
    expect(
      getByText("Merci de déposer un certificat de cette saison."),
    ).toBeTruthy();
    // The raw code is never shown.
    expect(queryByText("CERTIFICATE_TOO_OLD")).toBeNull();
  });

  it("shows the comment alone when the refusal carries no reason", async () => {
    (useLicenseRenewalLogic as jest.Mock).mockReturnValue({
      ...mockedLogic(),
      request: {
        id: "req-1",
        status: "REJECTED",
        rejectionReason: null,
        reviewComment: "Document illisible, merci de recommencer.",
        documents: [],
      },
      loading: false,
      step: "rejected",
    });

    const { getByText, queryByText } = await render(
      <LicenseRenewalScreen
        {...createMockScreenProps("LicenseRenewal", undefined)}
      />,
    );

    expect(getByText("Document illisible, merci de recommencer.")).toBeTruthy();
    expect(queryByText("Motif du refus")).toBeNull();
  });

  it("hides the details block of a refusal without reason nor comment", async () => {
    (useLicenseRenewalLogic as jest.Mock).mockReturnValue({
      ...mockedLogic(),
      request: {
        id: "req-1",
        status: "REJECTED",
        rejectionReason: null,
        reviewComment: null,
        documents: [],
      },
      loading: false,
      step: "rejected",
    });

    const { queryByTestId, getByText } = await render(
      <LicenseRenewalScreen
        {...createMockScreenProps("LicenseRenewal", undefined)}
      />,
    );

    expect(getByText("Demande refusée")).toBeTruthy();
    expect(queryByTestId("renewal-rejection-details")).toBeNull();
  });

  it("says a submitted request is being checked, with its date", async () => {
    (useLicenseRenewalLogic as jest.Mock).mockReturnValue({
      ...mockedLogic(),
      request: {
        id: "req-1",
        status: "PENDING",
        submittedAt: "2026-10-09T10:00:00Z",
        documents: [],
      },
      loading: false,
      step: "submitted",
    });

    const { getByText } = await render(
      <LicenseRenewalScreen
        {...createMockScreenProps("LicenseRenewal", undefined)}
      />,
    );

    expect(getByText("Demande en cours de vérification")).toBeTruthy();
    expect(getByText("Envoyée le 09/10/2026")).toBeTruthy();
  });

  it("shows OCR warnings at upload without blocking the submission (#268)", async () => {
    const medical = {
      id: "doc-1",
      requestId: "req-1",
      type: "MEDICAL_CERTIFICATE",
      filePath: "m.jpg",
      ocrData: { isApte: false },
      createdAt: "2026-10-01T00:00:00Z",
    };
    const licence = {
      id: "doc-2",
      requestId: "req-1",
      type: "LICENSE_CERTIFICATE",
      filePath: "l.jpg",
      ocrData: {},
      createdAt: "2026-10-01T00:00:00Z",
    };
    const submit = jest.fn().mockResolvedValue(undefined);
    (useLicenseRenewalLogic as jest.Mock).mockReturnValue({
      ...mockedLogic(),
      request: { id: "req-1", status: "DRAFT", documents: [medical, licence] },
      loading: false,
      step: "documents",
      canSubmit: true,
      getDoc: (type: string) =>
        type === "MEDICAL_CERTIFICATE" ? medical : licence,
      submit,
    });

    const { getByTestId, getByText, getAllByText, queryByText } = await render(
      <LicenseRenewalScreen
        {...createMockScreenProps("LicenseRenewal", undefined)}
      />,
    );

    expect(getByTestId("ocr-warnings-MEDICAL_CERTIFICATE")).toBeTruthy();
    expect(
      getByText(
        "Le certificat semble mentionner une contre-indication à la pratique.",
      ),
    ).toBeTruthy();
    expect(getByTestId("ocr-warnings-LICENSE_CERTIFICATE")).toBeTruthy();
    expect(getByText("Le numéro de licence n’a pas pu être lu.")).toBeTruthy();
    expect(getAllByText(/À titre indicatif/)).toHaveLength(2);
    expect(queryByText("Non apte")).toBeNull();

    await fireEvent.press(getByText("Soumettre la demande"));
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
