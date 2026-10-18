import {
  CSV_TOO_LONG_MESSAGE,
  csvLengthError,
  deletionSummary,
  lineErrors,
  MAX_RESULTS_CSV_LENGTH,
  reportRows,
} from './resultsImport';

describe('results import helpers', () => {
  it('accepts a CSV up to the API bound and refuses one character more', () => {
    expect(csvLengthError('a'.repeat(MAX_RESULTS_CSV_LENGTH))).toBeNull();
    expect(csvLengthError('a'.repeat(MAX_RESULTS_CSV_LENGTH + 1))).toBe(CSV_TOO_LONG_MESSAGE);
    expect(CSV_TOO_LONG_MESSAGE).toMatch(/80\s000 caractères au plus/);
  });

  it('reads the line errors of a refused file and drops malformed entries', () => {
    expect(
      lineErrors({
        message: "Fichier de résultats invalide : rien n'a été importé",
        errors: [
          { line: 2, message: 'classement invalide' },
          { line: '3', message: 'x' },
          null,
          { line: 4 },
          { line: 5, message: 'épreuve inconnue : « Swing »' },
        ],
      }),
    ).toEqual([
      { line: 2, message: 'classement invalide' },
      { line: 5, message: 'épreuve inconnue : « Swing »' },
    ]);
  });

  it('has no line errors for other error bodies', () => {
    expect(lineErrors({ message: 'Accès refusé' })).toEqual([]);
    expect(lineErrors({ errors: 'oops' })).toEqual([]);
    expect(lineErrors(null)).toEqual([]);
    expect(lineErrors(new TypeError('fetch failed'))).toEqual([]);
  });

  it('labels every counter of a report, in display order', () => {
    expect(
      reportRows({
        created: 1200,
        updated: 2,
        unchanged: 0,
        relinked: 1,
        anonymisedKept: 0,
        linked: 3,
        unlinked: 4,
      }).map((r) => [r.label, r.value.replace(/\s/g, ' ')]),
    ).toEqual([
      ['Créées', '1 200'],
      ['Mises à jour', '2'],
      ['Inchangées', '0'],
      ['Rattachements modifiés', '1'],
      ['Anonymisées conservées', '0'],
      ['Rattachées à un compte', '3'],
      ['Sans compte', '4'],
    ]);
  });

  it('shows withheld counters as « non communiqué »', () => {
    const rows = reportRows({
      created: 1,
      updated: 0,
      unchanged: 0,
      relinked: null,
      anonymisedKept: null,
      linked: null,
      unlinked: null,
    });
    expect(rows.filter((r) => r.value === 'non communiqué').map((r) => r.key)).toEqual([
      'relinked',
      'anonymisedKept',
      'linked',
      'unlinked',
    ]);
  });

  it('sums up a deletion', () => {
    expect(deletionSummary({ deleted: 0, anonymisedKept: 0 })).toBe(
      'Aucun résultat importé à supprimer.',
    );
    expect(deletionSummary({ deleted: 1, anonymisedKept: 0 })).toBe('1 résultat supprimé.');
    expect(deletionSummary({ deleted: 1, anonymisedKept: null })).toBe('1 résultat supprimé.');
    expect(deletionSummary({ deleted: 3, anonymisedKept: 1 })).toBe(
      '3 résultats supprimés ; 1 ligne anonymisée conservée (effacement RGPD).',
    );
    expect(deletionSummary({ deleted: 2, anonymisedKept: 2 })).toBe(
      '2 résultats supprimés ; 2 lignes anonymisées conservées (effacement RGPD).',
    );
  });
});
