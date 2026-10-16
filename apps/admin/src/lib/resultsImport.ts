/**
 * Results import of a competition (#652, #690): the client-side size check,
 * the line errors of a refused file and the labelled counters of a report.
 */

/** Same bound as the API (`MAX_RESULTS_CSV_LENGTH`): about 1,000 lines. */
export const MAX_RESULTS_CSV_LENGTH = 80_000;

export const CSV_TOO_LONG_MESSAGE = `Fichier trop volumineux : ${MAX_RESULTS_CSV_LENGTH.toLocaleString(
  'fr-FR',
)} caractères au plus. Découpez-le, par exemple un fichier par épreuve.`;

/** Error message of a CSV the API would refuse for its size, null when it fits. */
export function csvLengthError(csv: string): string | null {
  return csv.length > MAX_RESULTS_CSV_LENGTH ? CSV_TOO_LONG_MESSAGE : null;
}

/** Columns of the file, for the help text (docs/exploitation/import-resultats.md). */
export const RESULTS_CSV_COLUMNS: readonly { name: string; required: boolean; help: string }[] = [
  {
    name: 'epreuve',
    required: true,
    help: "identifiant de l'épreuve (liste ci-dessous) ou son nom, par ex. « Latines Adultes Avancé »",
  },
  { name: 'tour', required: true, help: '« Finale », « 1/2 finale »…' },
  { name: 'classement', required: true, help: 'rang dans le tour, entier ≥ 1' },
  { name: 'couple', required: true, help: 'libellé publié, par ex. « Martin / Durand »' },
  { name: 'dossard', required: false, help: 'reconnaît aussi le couple d’un import à l’autre' },
  { name: 'club', required: false, help: 'club du couple' },
  { name: 'licences', required: false, help: 'numéros de licence séparés par |' },
  { name: 'statut', required: false, help: 'QUALIFIED ou ELIMINATED' },
  { name: 'participants', required: false, help: 'nombre de couples du tour' },
];

export interface ResultLineError {
  line: number;
  message: string;
}

/** Line errors of a refused file (400 `{ message, errors: [{ line, message }] }`), else []. */
export function lineErrors(body: unknown): ResultLineError[] {
  if (typeof body !== 'object' || body === null) return [];
  const { errors } = body as { errors?: unknown };
  if (!Array.isArray(errors)) return [];
  return errors.filter(
    (e): e is ResultLineError =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as { line?: unknown }).line === 'number' &&
      typeof (e as { message?: unknown }).message === 'string',
  );
}

const REPORT_LABELS = {
  created: 'Créées',
  updated: 'Mises à jour',
  unchanged: 'Inchangées',
  relinked: 'Rattachements modifiés',
  anonymisedKept: 'Anonymisées conservées',
  linked: 'Rattachées à un compte',
  unlinked: 'Sans compte',
} as const;

type ReportKey = keyof typeof REPORT_LABELS;

/**
 * Counters of an import report. The licence-based ones are null when withheld
 * (a club account calls the API); an admin always gets numbers.
 */
export type ImportReportCounts = Record<ReportKey, number | null>;

export const WITHHELD_LABEL = 'non communiqué';

/** Labelled rows of a report, in display order. */
export function reportRows(
  report: ImportReportCounts,
): { key: ReportKey; label: string; value: string }[] {
  return (Object.keys(REPORT_LABELS) as ReportKey[]).map((key) => {
    const value = report[key];
    return {
      key,
      label: REPORT_LABELS[key],
      value: value === null ? WITHHELD_LABEL : value.toLocaleString('fr-FR'),
    };
  });
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** One sentence for the outcome of « Supprimer les résultats importés ». */
export function deletionSummary(report: { deleted: number; anonymisedKept: number }): string {
  const deleted =
    report.deleted === 0
      ? 'Aucun résultat importé à supprimer'
      : `${plural(report.deleted, 'résultat')} supprimé${report.deleted > 1 ? 's' : ''}`;
  if (report.anonymisedKept === 0) return `${deleted}.`;
  return `${deleted} ; ${plural(report.anonymisedKept, 'ligne')} anonymisée${
    report.anonymisedKept > 1 ? 's' : ''
  } conservée${report.anonymisedKept > 1 ? 's' : ''} (effacement RGPD).`;
}
