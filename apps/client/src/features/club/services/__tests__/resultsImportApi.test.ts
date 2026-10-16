/**
 * Results import by the organising club (#690) through the generated
 * OpenAPI client: POST /competitions/:id/results/import.
 */
import { competitionsControllerImportResults } from "../../../../api/generated/sdk.gen";
import {
  importCompetitionResults,
  isResultsCsvTooLarge,
  MAX_RESULTS_CSV_LENGTH,
} from "../resultsImportApi";

jest.mock("../../../../api/client", () => ({}));
jest.mock("../../../../api/generated/sdk.gen", () => ({
  competitionsControllerImportResults: jest.fn(),
}));

const postMock = competitionsControllerImportResults as jest.Mock;

const report = {
  dryRun: true,
  created: 3,
  updated: 1,
  unchanged: 0,
  relinked: null,
  anonymisedKept: null,
  linked: null,
  unlinked: null,
};

const httpError = (status: number, error: unknown = {}) => ({
  error,
  response: { status },
});

describe("resultsImportApi (#690)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("runs a dry run and returns the counts", async () => {
    postMock.mockResolvedValue({ data: report, response: { status: 200 } });

    await expect(
      importCompetitionResults("comp-1", "csv", { dryRun: true }),
    ).resolves.toEqual({ ok: true, report });
    expect(postMock).toHaveBeenCalledWith({
      path: { id: "comp-1" },
      query: { dryRun: true },
      body: { csv: "csv" },
    });
  });

  it("imports for real when dryRun is false", async () => {
    postMock.mockResolvedValue({ data: { ...report, dryRun: false } });

    await importCompetitionResults("comp-1", "csv", { dryRun: false });
    expect(postMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: { dryRun: false } }),
    );
  });

  it("returns the server's line errors of a refused file (400)", async () => {
    postMock.mockResolvedValue(
      httpError(400, {
        message: "Le fichier contient 2 ligne(s) en erreur",
        errors: [
          { line: 3, message: "classement invalide" },
          { line: 7, message: "épreuve inconnue" },
          { nonsense: true },
        ],
      }),
    );

    await expect(
      importCompetitionResults("comp-1", "csv", { dryRun: true }),
    ).resolves.toEqual({
      ok: false,
      kind: "invalid",
      message: "Le fichier contient 2 ligne(s) en erreur",
      errors: [
        { line: 3, message: "classement invalide" },
        { line: 7, message: "épreuve inconnue" },
      ],
    });
  });

  it("falls back to a generic message for a 400 without a body", async () => {
    postMock.mockResolvedValue(httpError(400, null));

    await expect(
      importCompetitionResults("comp-1", "csv", { dryRun: true }),
    ).resolves.toMatchObject({
      kind: "invalid",
      message: "Le fichier contient des erreurs.",
      errors: [],
    });
  });

  it("takes the first validation message of a 400 array", async () => {
    postMock.mockResolvedValue(
      httpError(400, { message: ["csv must be shorter"] }),
    );

    await expect(
      importCompetitionResults("comp-1", "csv", { dryRun: true }),
    ).resolves.toMatchObject({ message: "csv must be shorter" });
  });

  it.each([
    [403, "forbidden", /seul le club organisateur/],
    [404, "notFound", /introuvable/],
    [413, "tooLarge", /Découpez-le par épreuve/],
    [503, "unavailable", /pas disponible/],
    [500, "unknown", /L'import a échoué/],
  ])("explains a %i in French", async (status, kind, message) => {
    postMock.mockResolvedValue(httpError(status));

    await expect(
      importCompetitionResults("comp-1", "csv", { dryRun: false }),
    ).resolves.toMatchObject({ ok: false, kind, message });
  });

  it("reports a network failure (no response, or the call throws)", async () => {
    postMock.mockResolvedValueOnce({ error: new TypeError("Network") });
    await expect(
      importCompetitionResults("comp-1", "csv", { dryRun: true }),
    ).resolves.toMatchObject({ kind: "network" });

    postMock.mockRejectedValueOnce(new TypeError("Network request failed"));
    await expect(
      importCompetitionResults("comp-1", "csv", { dryRun: true }),
    ).resolves.toMatchObject({
      kind: "network",
      message: expect.stringContaining("Vérifiez votre connexion") as unknown,
    });
  });

  it("refuses a text over 80 000 characters without calling the server", async () => {
    const csv = "x".repeat(MAX_RESULTS_CSV_LENGTH + 1);

    expect(isResultsCsvTooLarge(csv)).toBe(true);
    expect(isResultsCsvTooLarge("x".repeat(MAX_RESULTS_CSV_LENGTH))).toBe(
      false,
    );
    await expect(
      importCompetitionResults("comp-1", csv, { dryRun: true }),
    ).resolves.toMatchObject({ ok: false, kind: "tooLarge" });
    expect(postMock).not.toHaveBeenCalled();
  });
});
