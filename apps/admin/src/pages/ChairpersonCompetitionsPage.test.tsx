import { screen, waitFor, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { readableYears } from '../lib/chairperson';
import { pickOption, renderWithProviders, setupUser } from '../test/render';
import { ChairpersonCompetitionsPage } from './ChairpersonCompetitionsPage';

const ok = (data: unknown) => ({ data, error: undefined });
const fail = (statusCode: number, message: string) => ({
  data: undefined,
  error: { statusCode, message },
});

const BASE = 'https://chairperson.ddsbagnols.com/resultats';
const item = (folder: string, title: string, match: Record<string, unknown>, extra = {}) => ({
  date: '2026-10-17',
  title,
  category: 'Ep. à Points, Opens',
  exportUrl: `${BASE}/${folder}/index.htm`,
  match: { competitionId: null, candidates: [], ...match },
  resultsAlreadyImported: false,
  ...extra,
});

const LIST = {
  years: [2026, 2025],
  truncated: false,
  items: [
    item(
      '20261017_exempleville',
      'Exempleville, Trophée',
      { status: 'MATCHED', competitionId: 'comp-1' },
      { resultsAlreadyImported: true },
    ),
    item('20261017_fictiveville', 'Fictiveville, Open', {
      status: 'AMBIGUOUS',
      candidates: [
        { id: 'comp-2', title: 'Open A' },
        { id: 'comp-3', title: 'Open B' },
      ],
    }),
    item('20261010_ailleurs', 'Ailleurs', { status: 'NONE' }),
  ],
};

const report = {
  dryRun: true,
  created: 3,
  updated: 0,
  unchanged: 0,
  relinked: 0,
  anonymisedKept: 0,
  linked: 2,
  unlinked: 1,
  events: [],
};

let user: UserEvent;

const statusSpy = (enabled: boolean) =>
  vi.spyOn(sdk, 'adminTopTurnierControllerStatus').mockResolvedValue(ok({ enabled }) as never);

describe('ChairpersonCompetitionsPage (#801, temporary)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    user = setupUser();
  });

  it('never reads the site on load: only on « Lire la liste »', async () => {
    statusSpy(true);
    const list = vi
      .spyOn(sdk, 'adminTopTurnierControllerCompetitions')
      .mockResolvedValue(ok(LIST) as never);
    renderWithProviders(<ChairpersonCompetitionsPage />);
    await screen.findByRole('button', { name: 'Lire la liste' });
    expect(screen.getByText(/Choisissez l’année puis cliquez/)).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Lire la liste' }));
    await screen.findByRole('table', { name: 'Compétitions récentes du site chairperson' });
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({ query: { year: undefined } });
    expect(screen.getByText('3 compétitions, 1 rapprochée, 1 à choisir')).toBeInTheDocument();
  });

  it('reads one year when chosen', async () => {
    statusSpy(true);
    const list = vi
      .spyOn(sdk, 'adminTopTurnierControllerCompetitions')
      .mockResolvedValue(ok({ ...LIST, items: [] }) as never);
    renderWithProviders(<ChairpersonCompetitionsPage />);
    const years = await screen.findByRole('textbox', { name: 'Année' });
    const [, previous] = readableYears();
    await pickOption(user, years, String(previous));
    await user.click(screen.getByRole('button', { name: 'Lire la liste' }));
    await screen.findByText('Aucune compétition sur le site pour cette période');
    expect(list.mock.calls[0][0]).toEqual({ query: { year: previous } });
  });

  it('shows the match of each row: matched, to pick, none', async () => {
    statusSpy(true);
    vi.spyOn(sdk, 'adminTopTurnierControllerCompetitions').mockResolvedValue(ok(LIST) as never);
    renderWithProviders(<ChairpersonCompetitionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Lire la liste' }));
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Rapprochée')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Résultats déjà présents')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('link', { name: 'Voir la compétition' })).toHaveAttribute(
      'href',
      '/competitions/comp-1',
    );
    expect(within(rows[1]).getByText('À choisir')).toBeInTheDocument();
    // Nothing is guessed: an ambiguous row waits for a pick.
    expect(within(rows[1]).getByRole('button', { name: /Vérifier/ })).toBeDisabled();
    expect(within(rows[2]).getByText('Non trouvée')).toBeInTheDocument();
    expect(
      within(rows[2]).getByText('Aucune compétition correspondante dans l’app'),
    ).toBeInTheDocument();
    expect(within(rows[2]).queryByRole('button')).toBeNull();
  });

  it('« Vérifier » runs the dry run of the listed export, then « Importer » imports it', async () => {
    statusSpy(true);
    vi.spyOn(sdk, 'adminTopTurnierControllerCompetitions').mockResolvedValue(ok(LIST) as never);
    const importUrl = vi
      .spyOn(sdk, 'competitionsControllerImportTopTurnierUrlResults')
      .mockResolvedValueOnce(ok(report) as never)
      .mockResolvedValueOnce(ok({ ...report, dryRun: false }) as never);
    renderWithProviders(<ChairpersonCompetitionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Lire la liste' }));
    await user.click(
      await screen.findByRole('button', { name: 'Vérifier « Exempleville, Trophée »' }),
    );

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Export valide : rien n’a encore été importé');
    expect(importUrl).toHaveBeenCalledTimes(1);
    expect(importUrl).toHaveBeenCalledWith({
      path: { id: 'comp-1' },
      query: { dryRun: true },
      body: { url: `${BASE}/20261017_exempleville/index.htm` },
    });
    expect(within(dialog).getByRole('textbox', { name: /Adresse de l’export/ })).toHaveAttribute(
      'readonly',
    );

    await user.click(within(dialog).getByRole('button', { name: 'Importer depuis l’adresse' }));
    await within(dialog).findByText('Résultats importés');
    expect(importUrl).toHaveBeenLastCalledWith({
      path: { id: 'comp-1' },
      query: { dryRun: false },
      body: { url: `${BASE}/20261017_exempleville/index.htm` },
    });
  });

  it('an ambiguous row is imported into the competition the staff picked', async () => {
    statusSpy(true);
    vi.spyOn(sdk, 'adminTopTurnierControllerCompetitions').mockResolvedValue(ok(LIST) as never);
    const importUrl = vi
      .spyOn(sdk, 'competitionsControllerImportTopTurnierUrlResults')
      .mockResolvedValue(ok(report) as never);
    renderWithProviders(<ChairpersonCompetitionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Lire la liste' }));
    await pickOption(
      user,
      await screen.findByRole('textbox', {
        name: 'Compétition de l’app pour « Fictiveville, Open »',
      }),
      'Open B',
    );
    const verify = screen.getByRole('button', { name: 'Vérifier « Fictiveville, Open »' });
    expect(verify).toBeEnabled();
    await user.click(verify);
    await waitFor(() =>
      expect(importUrl).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 'comp-3' }, query: { dryRun: true } }),
      ),
    );
  });

  it('says when the feature is off, without reading the site', async () => {
    statusSpy(false);
    const list = vi.spyOn(sdk, 'adminTopTurnierControllerCompetitions');
    renderWithProviders(<ChairpersonCompetitionsPage />);
    await screen.findByText('Fonction désactivée sur cet environnement');
    expect(screen.queryByRole('button', { name: 'Lire la liste' })).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it('turns a 404 of the list into the « feature off » notice', async () => {
    statusSpy(true);
    vi.spyOn(sdk, 'adminTopTurnierControllerCompetitions').mockResolvedValue(
      fail(404, 'désactivée') as never,
    );
    renderWithProviders(<ChairpersonCompetitionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Lire la liste' }));
    await screen.findByText('Fonction désactivée sur cet environnement');
  });

  it('shows the error of the site (busy, unreachable)', async () => {
    statusSpy(true);
    vi.spyOn(sdk, 'adminTopTurnierControllerCompetitions')
      .mockResolvedValueOnce(fail(409, 'Une lecture de ce site est déjà en cours') as never)
      .mockResolvedValueOnce(fail(502, 'Site injoignable') as never);
    renderWithProviders(<ChairpersonCompetitionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Lire la liste' }));
    await screen.findByText('Une lecture de ce site est déjà en cours');
    await user.click(screen.getByRole('button', { name: 'Lire la liste' }));
    await screen.findByText('Site injoignable');
  });
});
