import type { ImportResultsReportDto } from "../../../api/generated/types.gen";
import type { ResultsImportLineError } from "../services/resultsImportApi";

/**
 * Wording of the results import screen (#690), kept out of the component so
 * it can be tested on its own.
 *
 * Only the published-content counts (created / updated / unchanged) are
 * shown: the account-link counts are withheld from club accounts by the
 * server (they would reveal what licence numbers resolve to).
 */

/** « Ligne 3 : classement invalide… » */
export function formatLineError({ line, message }: ResultsImportLineError) {
  return `Ligne ${line} : ${message}`;
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count > 1 ? many : one}`;

/** Plain-French sentence of what a dry run found. */
export function formatPreview(
  report: Pick<ImportResultsReportDto, "created" | "updated" | "unchanged">,
): string {
  const total = report.created + report.updated + report.unchanged;
  if (total === 0) return "Le fichier ne contient aucun résultat à importer.";
  const parts = [
    `${plural(report.created, "résultat sera créé", "résultats seront créés")}`,
    `${plural(report.updated, "sera mis à jour", "seront mis à jour")}`,
    `${plural(report.unchanged, "est déjà à jour", "sont déjà à jour")}`,
  ];
  return `Fichier valide : ${parts.join(", ")}.`;
}

export interface ReportRow {
  key: "created" | "updated" | "unchanged";
  label: string;
  value: number;
}

/** Rows of the report shown after an import. */
export function reportRows(
  report: Pick<ImportResultsReportDto, "created" | "updated" | "unchanged">,
): ReportRow[] {
  return [
    { key: "created", label: "Résultats créés", value: report.created },
    { key: "updated", label: "Résultats mis à jour", value: report.updated },
    { key: "unchanged", label: "Résultats inchangés", value: report.unchanged },
  ];
}

/** Columns of the expected CSV, for the help block. */
export const RESULTS_CSV_COLUMNS: readonly {
  name: string;
  description: string;
  required: boolean;
}[] = [
  {
    name: "epreuve",
    description: "identifiant ou nom de l'épreuve (ex. Latines Adultes Avancé)",
    required: true,
  },
  { name: "tour", description: "Finale, 1/2 finale…", required: true },
  {
    name: "classement",
    description: "rang dans le tour (1, 2, 3…)",
    required: true,
  },
  {
    name: "couple",
    description: "libellé publié, ex. Martin / Durand",
    required: true,
  },
  { name: "dossard", description: "numéro de dossard", required: false },
  { name: "club", description: "club du couple", required: false },
  {
    name: "licences",
    description: "numéros de licence séparés par |",
    required: false,
  },
  { name: "statut", description: "QUALIFIED ou ELIMINATED", required: false },
  {
    name: "participants",
    description: "nombre de couples du tour",
    required: false,
  },
];
