// Side-effect: configures the generated OpenAPI client (baseUrl + auth + refresh).
import "../../../api/client";
import { competitionsControllerImportResults } from "../../../api/generated/sdk.gen";
import type { ImportResultsReportDto } from "../../../api/generated/types.gen";

/**
 * Import of a competition's published results by its organising club (#690):
 * POST /competitions/:id/results/import?dryRun=true|false with `{ csv }`.
 * Waking a sleeping backend is handled globally (backendWake): no retry here.
 */

/** Largest CSV the server accepts (characters), same limit as the DTO. */
export const MAX_RESULTS_CSV_LENGTH = 80_000;

/** One rejected line of the file, as reported by the server (French). */
export interface ResultsImportLineError {
  line: number;
  message: string;
}

export type ResultsImportFailureKind =
  | "invalid"
  | "tooLarge"
  | "forbidden"
  | "notFound"
  | "unavailable"
  | "network"
  | "unknown";

export type ResultsImportOutcome =
  | { ok: true; report: ImportResultsReportDto }
  | {
      ok: false;
      kind: ResultsImportFailureKind;
      /** French, meant for the club. */
      message: string;
      /** Rejected lines (only for `invalid`). */
      errors: ResultsImportLineError[];
    };

const MESSAGES: Record<Exclude<ResultsImportFailureKind, "invalid">, string> = {
  tooLarge:
    "Le fichier dépasse 80 000 caractères. Découpez-le par épreuve et importez chaque partie séparément.",
  forbidden:
    "Vous ne pouvez pas importer les résultats de cette compétition : seul le club organisateur le peut, et pas depuis une session « connecté en tant que ».",
  notFound: "Cette compétition est introuvable.",
  unavailable:
    "L'import des résultats n'est pas disponible pour le moment. Réessayez plus tard.",
  network:
    "Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.",
  unknown: "L'import a échoué. Réessayez dans quelques instants.",
};

const failure = (
  kind: ResultsImportFailureKind,
  message: string = kind === "invalid" ? "" : MESSAGES[kind],
  errors: ResultsImportLineError[] = [],
): ResultsImportOutcome => ({ ok: false, kind, message, errors });

/** True when the text exceeds what the server accepts in one import. */
export function isResultsCsvTooLarge(csv: string): boolean {
  return csv.length > MAX_RESULTS_CSV_LENGTH;
}

function isLineError(value: unknown): value is ResultsImportLineError {
  if (typeof value !== "object" || value === null) return false;
  const { line, message } = value as { line?: unknown; message?: unknown };
  return typeof line === "number" && typeof message === "string";
}

/** `{ message, errors: [{ line, message }] }` of a 400 (refused file). */
function parseInvalidFile(error: unknown): {
  message: string | null;
  errors: ResultsImportLineError[];
} {
  if (typeof error !== "object" || error === null) {
    return { message: null, errors: [] };
  }
  const { message, errors } = error as { message?: unknown; errors?: unknown };
  const text =
    typeof message === "string"
      ? message
      : Array.isArray(message) && typeof message[0] === "string"
        ? message[0]
        : null;
  return {
    message: text,
    errors: Array.isArray(errors) ? errors.filter(isLineError) : [],
  };
}

/**
 * Checks (`dryRun: true`, nothing written) or imports the CSV. Never throws:
 * every failure comes back as a French message the screen can show.
 */
export async function importCompetitionResults(
  competitionId: string,
  csv: string,
  { dryRun }: { dryRun: boolean },
): Promise<ResultsImportOutcome> {
  if (isResultsCsvTooLarge(csv)) return failure("tooLarge");

  let result: Awaited<ReturnType<typeof competitionsControllerImportResults>>;
  try {
    result = await competitionsControllerImportResults({
      path: { id: competitionId },
      query: { dryRun },
      body: { csv },
    });
  } catch {
    return failure("network");
  }

  const { data, error, response } = result;
  if (!error && data) return { ok: true, report: data };

  const status = response?.status;
  switch (status) {
    case 400: {
      const parsed = parseInvalidFile(error);
      return failure(
        "invalid",
        parsed.message ?? "Le fichier contient des erreurs.",
        parsed.errors,
      );
    }
    case 403:
      return failure("forbidden");
    case 404:
      return failure("notFound");
    case 413:
      return failure("tooLarge");
    case 503:
      return failure("unavailable");
    case undefined:
      return failure("network");
    default:
      return failure("unknown");
  }
}
