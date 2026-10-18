import { screen, waitFor, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { MAX_RESULTS_CSV_LENGTH } from '../lib/resultsImport';
import { fill, renderWithProviders, setupUser } from '../test/render';
import { CompetitionDetailPage } from './CompetitionDetailPage';

const CSV = 'epreuve;tour;classement;couple\nLatines Adultes Avancé;Finale;1;Martin / Durand';

const report = (overrides: Record<string, unknown> = {}) => ({
  dryRun: true,
  created: 3,
  updated: 1,
  unchanged: 0,
  relinked: 0,
  anonymisedKept: 0,
  linked: 2,
  unlinked: 2,
  ...overrides,
});

const event = (overrides: Record<string, unknown> = {}) => ({
  id: 'ev-lat',
  eventKind: 'CLASSIFICATRICE',
  eventType: 'COUPLE',
  category: 'Latin',
  ageGroup: 'Adultes',
  ageGroups: ['Adultes'],
  level: 'Avancé',
  openLevels: [],
  locked: true,
  ...overrides,
});

const ok = (data: unknown) => ({ data, error: undefined });

let user: UserEvent;

function renderPage() {
  vi.spyOn(sdk, 'competitionsControllerFindOne').mockResolvedValue(
    ok({
      id: 'comp-1',
      title: 'Open de Lyon',
      date: '2026-11-07T09:00:00.000Z',
      endDate: null,
      city: 'Lyon',
      status: 'PAST',
    }) as never,
  );
  const program = vi.spyOn(sdk, 'competitionsControllerGetProgram').mockResolvedValue(
    ok({
      competitionId: 'comp-1',
      syncedFromFfd: true,
      eventsSource: null,
      programEditedAt: null,
      events: [event(), event({ id: 'ev-std', category: 'Standard', level: null, locked: false })],
      schedule: [],
    }) as never,
  );
  renderWithProviders(
    <Routes>
      <Route path="/competitions/:id" element={<CompetitionDetailPage />} />
    </Routes>,
    { route: '/competitions/comp-1' },
  );
  return { program };
}

const csvInput = () => screen.getByRole('textbox', { name: 'Contenu CSV' });
const checkButton = () => screen.getByRole('button', { name: 'Vérifier' });
const importButton = () => screen.getByRole('button', { name: 'Importer' });

describe('CompetitionDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    user = setupUser();
  });

  it('shows the competition, the CSV columns and its events', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Open de Lyon' })).toBeInTheDocument();
    expect(screen.getByText('Terminée')).toBeInTheDocument();
    expect(screen.getByText('Lieu : Lyon')).toBeInTheDocument();
    expect(screen.getByText('licences')).toBeInTheDocument();
    expect(await screen.findByText('Latines Adultes Avancé')).toBeInTheDocument();
    expect(screen.getByText('ev-lat')).toBeInTheDocument();
    expect(screen.getByText('Standards Adultes')).toBeInTheDocument();
    expect(checkButton()).toBeDisabled();
    expect(importButton()).toBeDisabled();
  });

  it('previews a valid file, then imports it and shows the report', async () => {
    renderPage();
    const send = vi
      .spyOn(sdk, 'competitionsControllerImportResults')
      .mockResolvedValueOnce(ok(report()) as never)
      .mockResolvedValueOnce(
        ok(report({ dryRun: false, relinked: null, anonymisedKept: null })) as never,
      );
    await fill(user, await screen.findByRole('textbox', { name: 'Contenu CSV' }), CSV);
    expect(importButton()).toBeDisabled();
    await user.click(checkButton());

    const preview = await screen.findByRole('table', { name: "Aperçu de l'import" });
    expect(within(preview).getByRole('row', { name: 'Créées 3' })).toBeInTheDocument();
    expect(within(preview).getByRole('row', { name: 'Sans compte 2' })).toBeInTheDocument();
    expect(send).toHaveBeenLastCalledWith({
      path: { id: 'comp-1' },
      query: { dryRun: true },
      body: { csv: CSV },
    });

    await user.click(importButton());
    const final = await screen.findByRole('table', { name: "Bilan de l'import" });
    expect(screen.getByText('Résultats importés')).toBeInTheDocument();
    expect(
      within(final).getByRole('row', { name: 'Rattachements modifiés non communiqué' }),
    ).toBeInTheDocument();
    expect(send).toHaveBeenLastCalledWith({
      path: { id: 'comp-1' },
      query: { dryRun: false },
      body: { csv: CSV },
    });
    expect(screen.queryByRole('table', { name: "Aperçu de l'import" })).not.toBeInTheDocument();
    expect(importButton()).toBeDisabled();
  });

  it('needs a new dry run once the text changes', async () => {
    renderPage();
    vi.spyOn(sdk, 'competitionsControllerImportResults').mockResolvedValue(ok(report()) as never);
    await fill(user, await screen.findByRole('textbox', { name: 'Contenu CSV' }), CSV);
    await user.click(checkButton());
    await waitFor(() => expect(importButton()).toBeEnabled());
    await user.type(csvInput(), ' ');
    expect(importButton()).toBeDisabled();
    expect(screen.queryByRole('table', { name: "Aperçu de l'import" })).not.toBeInTheDocument();
  });

  it('lists the line errors of a refused file and keeps « Importer » disabled', async () => {
    renderPage();
    vi.spyOn(sdk, 'competitionsControllerImportResults').mockResolvedValue({
      data: undefined,
      error: {
        statusCode: 400,
        message: "Fichier de résultats invalide : rien n'a été importé",
        errors: [
          { line: 2, message: 'classement invalide' },
          { line: 5, message: 'épreuve inconnue' },
        ],
      },
    } as never);
    await fill(user, await screen.findByRole('textbox', { name: 'Contenu CSV' }), CSV);
    await user.click(checkButton());

    expect(
      await screen.findByText("Fichier de résultats invalide : rien n'a été importé"),
    ).toBeInTheDocument();
    const errors = screen.getByRole('table', { name: 'Lignes en erreur' });
    expect(within(errors).getByRole('row', { name: '2 classement invalide' })).toBeInTheDocument();
    expect(within(errors).getByRole('row', { name: '5 épreuve inconnue' })).toBeInTheDocument();
    expect(importButton()).toBeDisabled();
  });

  it('shows the API message of a refusal without line errors', async () => {
    renderPage();
    vi.spyOn(sdk, 'competitionsControllerImportResults').mockResolvedValue({
      data: undefined,
      error: { statusCode: 503, message: 'Import des résultats indisponible' },
    } as never);
    await fill(user, await screen.findByRole('textbox', { name: 'Contenu CSV' }), CSV);
    await user.click(checkButton());
    expect(await screen.findByText('Import des résultats indisponible')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Lignes en erreur' })).not.toBeInTheDocument();
  });

  it('loads a picked .csv file into the text area', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Open de Lyon' });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await user.upload(input!, new File([CSV], 'resultats.csv', { type: 'text/csv' }));
    await waitFor(() => expect(csvInput()).toHaveValue(CSV));
    expect(checkButton()).toBeEnabled();
  });

  it('refuses a file over 80 000 characters without sending it', async () => {
    renderPage();
    const send = vi.spyOn(sdk, 'competitionsControllerImportResults');
    await screen.findByRole('heading', { name: 'Open de Lyon' });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    const big = 'a'.repeat(MAX_RESULTS_CSV_LENGTH + 1);
    await user.upload(input!, new File([big], 'gros.csv', { type: 'text/csv' }));
    expect(await screen.findByText(/Fichier trop volumineux/)).toBeInTheDocument();
    expect(csvInput()).toHaveValue('');
    expect(checkButton()).toBeDisabled();
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a pasted text over 80 000 characters', async () => {
    renderPage();
    const input = await screen.findByRole('textbox', { name: 'Contenu CSV' });
    await fill(user, input, 'a'.repeat(MAX_RESULTS_CSV_LENGTH + 1));
    expect(screen.getByText(/Fichier trop volumineux/)).toBeInTheDocument();
    expect(checkButton()).toBeDisabled();
  });

  it('deletes the imported results of an event after confirmation', async () => {
    const { program } = renderPage();
    const remove = vi
      .spyOn(sdk, 'competitionsControllerDeleteEventResults')
      .mockResolvedValue(ok({ deleted: 4, anonymisedKept: 1 }) as never);
    await user.click(
      await screen.findByRole('button', {
        name: 'Supprimer les résultats importés : Latines Adultes Avancé',
      }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Supprimer les résultats importés' });
    expect(within(dialog).getByText(/« Latines Adultes Avancé »/)).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
    expect(
      await screen.findByText(
        '4 résultats supprimés ; 1 ligne anonymisée conservée (effacement RGPD).',
      ),
    ).toBeInTheDocument();
    expect(remove).toHaveBeenCalledWith({
      path: { id: 'comp-1' },
      query: { eventId: 'ev-lat' },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // The programme is reloaded: an event without results is no longer locked.
    await waitFor(() => expect(program).toHaveBeenCalledTimes(2));
  });

  it('cancels a deletion without calling the API', async () => {
    renderPage();
    const remove = vi.spyOn(sdk, 'competitionsControllerDeleteEventResults');
    await user.click(
      await screen.findByRole('button', {
        name: 'Supprimer les résultats importés : Standards Adultes',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(remove).not.toHaveBeenCalled();
  });

  it('keeps the dialog open with the API message when the deletion fails', async () => {
    renderPage();
    vi.spyOn(sdk, 'competitionsControllerDeleteEventResults').mockResolvedValue({
      data: undefined,
      error: { statusCode: 403, message: 'Accès refusé' },
    } as never);
    await user.click(
      await screen.findByRole('button', {
        name: 'Supprimer les résultats importés : Latines Adultes Avancé',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('Accès refusé')).toBeInTheDocument();
  });

  describe('TopTurnier export (#786)', () => {
    const mapping = [
      {
        folder: '3-nat_adultsavancelat',
        label: 'Nat, Adults Avancé Latin',
        status: 'MATCHED',
        eventId: 'ev-lat',
        eventName: 'Latines Adulte Avancé',
        exact: true,
        rows: 3,
        message: null,
      },
      {
        folder: '19-nat_youthadultsdebutantlat',
        label: 'Nat, Youth/Adults Débutant Latin',
        status: 'NO_RESULTS',
        eventId: 'ev-x',
        eventName: 'Latines Youth Débutant',
        exact: false,
        rows: 0,
        message: 'pas de classement final (erg.htm) dans l’export',
      },
      {
        folder: '60-x',
        label: 'Gala, Formation Show',
        status: 'UNMATCHED',
        eventId: null,
        eventName: null,
        exact: null,
        rows: 1,
        message: 'type d’épreuve non reconnu',
      },
    ];
    const zip = () => new File(['PK'], 'export.zip', { type: 'application/zip' });

    async function openTopTurnier() {
      renderPage();
      await screen.findByRole('heading', { name: 'Open de Lyon' });
      await user.click(screen.getByRole('radio', { name: 'Export TopTurnier' }));
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(input).not.toBeNull();
      return input!;
    }

    it('checks the archive, shows the event mapping, then imports it', async () => {
      const input = await openTopTurnier();
      const send = vi
        .spyOn(sdk, 'competitionsControllerImportTopTurnierResults')
        .mockResolvedValueOnce(ok({ ...report(), events: mapping }) as never)
        .mockResolvedValueOnce(ok({ ...report({ dryRun: false }), events: mapping }) as never);
      const verify = screen.getByRole('button', { name: 'Vérifier l’export' });
      const save = screen.getByRole('button', { name: 'Importer l’export' });
      expect(verify).toBeDisabled();
      const file = zip();
      await user.upload(input, file);
      expect(screen.getByText('export.zip')).toBeInTheDocument();
      expect(save).toBeDisabled();
      await user.click(verify);

      const table = await screen.findByRole('table', { name: 'Correspondance des épreuves' });
      expect(screen.getByText('1 épreuve importée sur 3')).toBeInTheDocument();
      expect(
        within(table).getByRole('row', {
          name: 'Nat, Adults Avancé Latin Importée Latines Adulte Avancé 3 —',
        }),
      ).toBeInTheDocument();
      expect(
        within(table).getByText(
          'classes d’âge réunies : vérifier l’épreuve ; pas de classement final (erg.htm) dans l’export',
        ),
      ).toBeInTheDocument();
      expect(within(table).getByText('Non reconnue')).toBeInTheDocument();
      expect(
        screen.getByRole('table', { name: 'Aperçu de l’import TopTurnier' }),
      ).toBeInTheDocument();
      expect(send).toHaveBeenLastCalledWith({
        path: { id: 'comp-1' },
        query: { dryRun: true },
        body: { file },
      });

      await user.click(save);
      expect(
        await screen.findByRole('table', { name: 'Bilan de l’import TopTurnier' }),
      ).toBeInTheDocument();
      expect(send).toHaveBeenLastCalledWith({
        path: { id: 'comp-1' },
        query: { dryRun: false },
        body: { file },
      });
      expect(save).toBeDisabled();
    });

    it('shows the refusal, its line errors and the mapping', async () => {
      const input = await openTopTurnier();
      vi.spyOn(sdk, 'competitionsControllerImportTopTurnierResults').mockResolvedValue({
        data: undefined,
        error: {
          statusCode: 400,
          message: "Fichier de résultats invalide : rien n'a été importé",
          errors: [{ line: 4, message: '« OC, Sen.I/II Standard », ligne 2 : couple manquant' }],
          events: [{ ...mapping[0], status: 'INVALID', message: 'ligne 2 : couple manquant' }],
        },
      } as never);
      await user.upload(input, zip());
      await user.click(screen.getByRole('button', { name: 'Vérifier l’export' }));
      expect(
        await screen.findByText("Fichier de résultats invalide : rien n'a été importé"),
      ).toBeInTheDocument();
      expect(screen.getByRole('table', { name: 'Lignes en erreur' })).toBeInTheDocument();
      expect(screen.getByText('Illisible')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Importer l’export' })).toBeDisabled();
    });

    it('shows a failed import with its mapping', async () => {
      const input = await openTopTurnier();
      vi.spyOn(sdk, 'competitionsControllerImportTopTurnierResults')
        .mockResolvedValueOnce(ok({ ...report(), events: mapping }) as never)
        .mockResolvedValueOnce({
          data: undefined,
          error: { statusCode: 503, message: 'Import indisponible', events: mapping },
        } as never);
      await user.upload(input, zip());
      await user.click(screen.getByRole('button', { name: 'Vérifier l’export' }));
      await screen.findByRole('table', { name: 'Correspondance des épreuves' });
      await user.click(screen.getByRole('button', { name: 'Importer l’export' }));
      expect(await screen.findByText('Import indisponible')).toBeInTheDocument();
      expect(
        screen.getByRole('table', { name: 'Correspondance des épreuves' }),
      ).toBeInTheDocument();
    });

    it('refuses an archive over 10 MB without sending it', async () => {
      const input = await openTopTurnier();
      const send = vi.spyOn(sdk, 'competitionsControllerImportTopTurnierResults');
      const big = new File(['x'], 'gros.zip', { type: 'application/zip' });
      Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
      await user.upload(input, big);
      expect(await screen.findByRole('alert')).toHaveTextContent(/Archive trop volumineuse/);
      expect(screen.getByRole('button', { name: 'Vérifier l’export' })).toBeDisabled();
      expect(send).not.toHaveBeenCalled();
    });

    describe('URL import (#787, temporary)', () => {
      const URL_OK = 'https://chairperson.ddsbagnols.com/2026/x/index.htm';

      async function openUrl() {
        renderPage();
        await screen.findByRole('heading', { name: 'Open de Lyon' });
        await user.click(screen.getByRole('radio', { name: 'Adresse (temporaire)' }));
        return screen.getByRole('textbox', { name: /Adresse de l’export TopTurnier/ });
      }

      it('is flagged as temporary, checks the address, then imports it', async () => {
        const input = await openUrl();
        expect(screen.getByText('Solution temporaire')).toBeInTheDocument();
        const send = vi
          .spyOn(sdk, 'competitionsControllerImportTopTurnierUrlResults')
          .mockResolvedValueOnce(ok({ ...report(), events: mapping }) as never)
          .mockResolvedValueOnce(ok({ ...report({ dryRun: false }), events: mapping }) as never);
        const verify = screen.getByRole('button', { name: 'Vérifier l’adresse' });
        const save = screen.getByRole('button', { name: 'Importer depuis l’adresse' });
        expect(verify).toBeDisabled();
        await user.type(input, `  ${URL_OK} `);
        expect(save).toBeDisabled();
        await user.click(verify);
        await screen.findByRole('table', { name: 'Correspondance des épreuves' });
        expect(
          screen.getByRole('table', { name: 'Aperçu de l’import par adresse' }),
        ).toBeInTheDocument();
        expect(send).toHaveBeenLastCalledWith({
          path: { id: 'comp-1' },
          query: { dryRun: true },
          body: { url: URL_OK },
        });
        await user.click(save);
        expect(
          await screen.findByRole('table', { name: 'Bilan de l’import par adresse' }),
        ).toBeInTheDocument();
        expect(send).toHaveBeenLastCalledWith({
          path: { id: 'comp-1' },
          query: { dryRun: false },
          body: { url: URL_OK },
        });
      });

      it('shows a refusal (feature off or unsafe address) and requires a new check after an edit', async () => {
        const input = await openUrl();
        vi.spyOn(sdk, 'competitionsControllerImportTopTurnierUrlResults')
          .mockResolvedValueOnce({
            data: undefined,
            error: {
              statusCode: 404,
              message: 'Import par adresse TopTurnier désactivé sur cet environnement',
            },
          } as never)
          .mockResolvedValueOnce(ok({ ...report(), events: mapping }) as never);
        await user.type(input, URL_OK);
        await user.click(screen.getByRole('button', { name: 'Vérifier l’adresse' }));
        expect(
          await screen.findByText('Import par adresse TopTurnier désactivé sur cet environnement'),
        ).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Vérifier l’adresse' }));
        await screen.findByRole('table', { name: 'Correspondance des épreuves' });
        const save = screen.getByRole('button', { name: 'Importer depuis l’adresse' });
        expect(save).toBeEnabled();
        await user.type(input, 'x');
        expect(save).toBeDisabled();
      });
    });

    it('goes back to the CSV import', async () => {
      await openTopTurnier();
      await user.click(screen.getByRole('radio', { name: 'Fichier CSV' }));
      expect(screen.getByRole('textbox', { name: 'Contenu CSV' })).toBeInTheDocument();
    });
  });
});
