import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import React, { PropsWithChildren } from "react";
import { competitionsControllerImportResults } from "../../../../api/generated/sdk.gen";
import type { RootStackParamList } from "../../../../navigation/types";
import { MAX_RESULTS_CSV_LENGTH } from "../../services/resultsImportApi";
import { ClubResultsImportScreen } from "../ClubResultsImportScreen";

jest.mock("../../../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useTheme: () => ({
    theme: {
      background: "#fff",
      surface: "#f2f2f2",
      text: "#111",
      textSecondary: "#666",
      primary: "#3b82f6",
      border: "#e5e7eb",
      inputBackground: "#fafafa",
      danger: "#ef4444",
      success: "#22c55e",
    },
    isDark: false,
  }),
}));

jest.mock("expo-clipboard", () => ({ getStringAsync: jest.fn() }));

// Configure-client side-effect is irrelevant in tests.
jest.mock("../../../../api/client", () => ({}));
jest.mock("../../../../api/generated/sdk.gen", () => ({
  competitionsControllerImportResults: jest.fn(),
}));

const postMock = competitionsControllerImportResults as jest.Mock;

type Props = NativeStackScreenProps<RootStackParamList, "ClubResultsImport">;

const CSV =
  "epreuve;tour;classement;couple\nLatines Adultes Avancé;Finale;1;Martin / Durand";

const report = (dryRun: boolean) => ({
  dryRun,
  created: 12,
  updated: 3,
  unchanged: 1,
  relinked: null,
  anonymisedKept: null,
  linked: null,
  unlinked: null,
});

const navigation = { goBack: jest.fn(), navigate: jest.fn() };

const renderScreen = () =>
  render(
    <ClubResultsImportScreen
      navigation={navigation as unknown as Props["navigation"]}
      route={{
        key: "ClubResultsImport-1",
        name: "ClubResultsImport",
        params: { competitionId: "comp-1", competitionTitle: "Open de Lyon" },
      }}
    />,
  );

describe("ClubResultsImportScreen (#690)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows the competition, the column help and a disabled import", async () => {
    const { getByText, getByTestId } = await renderScreen();

    expect(getByText("Open de Lyon")).toBeTruthy();
    expect(getByTestId("results-import-help")).toBeTruthy();
    expect(getByText(/epreuve : identifiant ou nom/)).toBeTruthy();
    expect(getByText(/licences \(facultatif\)/)).toBeTruthy();
    expect(
      getByTestId("results-import-submit").props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });

  it("checks the text (dry run) and shows the preview in plain French", async () => {
    postMock.mockResolvedValue({ data: report(true) });
    const { getByTestId, findByTestId, getByText, queryByText } =
      await renderScreen();

    await fireEvent.changeText(getByTestId("results-import-input"), CSV);
    await fireEvent.press(getByTestId("results-import-check"));

    expect(await findByTestId("results-import-preview")).toBeTruthy();
    expect(postMock).toHaveBeenCalledWith({
      path: { id: "comp-1" },
      query: { dryRun: true },
      body: { csv: CSV },
    });
    expect(
      getByText(
        "Fichier valide : 12 résultats seront créés, 3 seront mis à jour, 1 est déjà à jour.",
      ),
    ).toBeTruthy();
    // Account-link counts are never shown in the club space.
    expect(queryByText(/compte/)).toBeNull();
    expect(
      getByTestId("results-import-submit").props.accessibilityState,
    ).toMatchObject({ disabled: false });
  });

  it("lists the line errors of a refused file and keeps import disabled", async () => {
    postMock.mockResolvedValue({
      error: {
        statusCode: 400,
        timestamp: "2026-10-16T10:00:00.000Z",
        path: "/api/v1/competitions/comp-1/results/import",
        method: "POST",
        message: "Fichier de résultats invalide : rien n'a été importé",
        errors: [
          { line: 3, message: "classement invalide (entier ≥ 1 attendu)" },
          { line: 5, message: "épreuve inconnue" },
        ],
      },
      response: { status: 400 },
    });
    const { getByTestId, findByText, getByText } = await renderScreen();

    await fireEvent.changeText(getByTestId("results-import-input"), CSV);
    await fireEvent.press(getByTestId("results-import-check"));

    expect(
      await findByText("Fichier de résultats invalide : rien n'a été importé"),
    ).toBeTruthy();
    expect(
      getByText("Ligne 3 : classement invalide (entier ≥ 1 attendu)"),
    ).toBeTruthy();
    expect(getByText("Ligne 5 : épreuve inconnue")).toBeTruthy();
    expect(
      getByTestId("results-import-submit").props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });

  it("imports the checked text and shows the report", async () => {
    postMock
      .mockResolvedValueOnce({ data: report(true) })
      .mockResolvedValueOnce({ data: report(false) });
    const { getByTestId, findByTestId, queryByTestId } = await renderScreen();

    await fireEvent.changeText(getByTestId("results-import-input"), CSV);
    await fireEvent.press(getByTestId("results-import-check"));
    await findByTestId("results-import-preview");
    await fireEvent.press(getByTestId("results-import-submit"));

    expect(await findByTestId("results-import-report")).toBeTruthy();
    expect(postMock).toHaveBeenLastCalledWith({
      path: { id: "comp-1" },
      query: { dryRun: false },
      body: { csv: CSV },
    });
    expect(
      getByTestId("results-import-report-created").props.accessibilityLabel,
    ).toBe("Résultats créés : 12");
    expect(
      getByTestId("results-import-report-updated").props.accessibilityLabel,
    ).toBe("Résultats mis à jour : 3");
    expect(
      getByTestId("results-import-report-unchanged").props.accessibilityLabel,
    ).toBe("Résultats inchangés : 1");
    expect(queryByTestId("results-import-preview")).toBeNull();
  });

  it("asks for a new check once the text is edited after a check", async () => {
    postMock.mockResolvedValue({ data: report(true) });
    const { getByTestId, findByTestId, queryByTestId } = await renderScreen();

    await fireEvent.changeText(getByTestId("results-import-input"), CSV);
    await fireEvent.press(getByTestId("results-import-check"));
    await findByTestId("results-import-preview");
    await fireEvent.changeText(
      getByTestId("results-import-input"),
      `${CSV}\nLatines Adultes Avancé;Finale;2;Petit / Grand`,
    );

    expect(queryByTestId("results-import-preview")).toBeNull();
    expect(
      getByTestId("results-import-submit").props.accessibilityState,
    ).toMatchObject({ disabled: true });
    await fireEvent.press(getByTestId("results-import-submit"));
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a text over 80 000 characters and suggests splitting it", async () => {
    const { getByTestId, findByTestId, getByText } = await renderScreen();

    await fireEvent.changeText(
      getByTestId("results-import-input"),
      "x".repeat(MAX_RESULTS_CSV_LENGTH + 1),
    );
    expect(
      getByText(/trop long : découpez le fichier par épreuve/),
    ).toBeTruthy();
    await fireEvent.press(getByTestId("results-import-check"));

    expect(await findByTestId("results-import-failure")).toBeTruthy();
    expect(getByText(/Découpez-le par épreuve/)).toBeTruthy();
    expect(postMock).not.toHaveBeenCalled();
  });

  it.each([
    [403, /seul le club organisateur/],
    [503, /pas disponible pour le moment/],
  ])("explains a %i in French", async (status, message) => {
    postMock.mockResolvedValue({ error: {}, response: { status } });
    const { getByTestId, findByText } = await renderScreen();

    await fireEvent.changeText(getByTestId("results-import-input"), CSV);
    await fireEvent.press(getByTestId("results-import-check"));

    expect(await findByText(message)).toBeTruthy();
  });

  it("explains a network failure", async () => {
    postMock.mockRejectedValue(new TypeError("Network request failed"));
    const { getByTestId, findByText } = await renderScreen();

    await fireEvent.changeText(getByTestId("results-import-input"), CSV);
    await fireEvent.press(getByTestId("results-import-check"));

    expect(await findByText(/Impossible de joindre le serveur/)).toBeTruthy();
  });

  it("pastes the clipboard into the text field", async () => {
    (Clipboard.getStringAsync as jest.Mock).mockResolvedValue(CSV);
    const { getByTestId, getByLabelText } = await renderScreen();

    await fireEvent.press(getByLabelText("Coller depuis le presse-papiers"));

    await waitFor(() => {
      expect(getByTestId("results-import-input").props.value).toBe(CSV);
    });
  });

  it("goes back from the header", async () => {
    const { getByLabelText } = await renderScreen();
    await fireEvent.press(getByLabelText(/retour/i));
    expect(navigation.goBack).toHaveBeenCalled();
  });
});
