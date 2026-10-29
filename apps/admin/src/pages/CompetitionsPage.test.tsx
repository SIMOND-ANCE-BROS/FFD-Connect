import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { renderWithProviders, setupUser } from '../test/render';
import { CompetitionsPage } from './CompetitionsPage';

const competition = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  title: 'Open de Lyon',
  date: '2026-11-07T09:00:00.000Z',
  endDate: '2026-11-08T18:00:00.000Z',
  location: 'Gymnase',
  city: 'Lyon',
  status: 'UPCOMING',
  ...overrides,
});

const page = (data: object[], total = data.length) => ({
  data: { data, meta: { total, skip: 0, take: 50, hasMore: total > data.length } },
  error: undefined,
});

const statuses = (rows: object[]) => ({ data: rows, error: undefined });

const mockStatuses = (rows: object[] = []) =>
  vi
    .spyOn(sdk, 'adminCompetitionsControllerResultsStatusList')
    .mockResolvedValue(statuses(rows) as never);

function renderPage(path = '/competitions') {
  return renderWithProviders(
    <Routes>
      <Route path="/competitions" element={<CompetitionsPage />} />
    </Routes>,
    { route: path },
  );
}

describe('CompetitionsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockStatuses();
  });

  it('lists the competitions with a link to each page', async () => {
    const list = vi
      .spyOn(sdk, 'competitionsControllerFindAll')
      .mockResolvedValue(page([competition()]) as never);
    renderPage();
    const link = await screen.findByRole('link', { name: 'Open de Lyon' });
    expect(link).toHaveAttribute('href', '/competitions/c1');
    const table = screen.getByRole('table');
    expect(within(table).getByText('07/11/2026 → 08/11/2026')).toBeInTheDocument();
    expect(within(table).getByText('Gymnase, Lyon')).toBeInTheDocument();
    expect(within(table).getByText('À venir')).toBeInTheDocument();
    expect(screen.getByText('1 compétition')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ query: { skip: 0, take: 50 } });
  });

  it('pages through the list', async () => {
    const list = vi
      .spyOn(sdk, 'competitionsControllerFindAll')
      .mockResolvedValue(page([competition()], 120) as never);
    const user = setupUser();
    renderPage();
    await screen.findByText('120 compétitions');
    await user.click(screen.getByRole('button', { name: '2' }));
    expect(list).toHaveBeenLastCalledWith({ query: { skip: 50, take: 50 } });
  });

  it('says when the list cannot be loaded', async () => {
    vi.spyOn(sdk, 'competitionsControllerFindAll').mockResolvedValue({
      data: undefined,
      error: { message: 'Erreur serveur' },
    } as never);
    renderPage();
    expect(await screen.findByText('Erreur serveur')).toBeInTheDocument();
  });

  it('shows whether the results are imported, in one request per page (#846)', async () => {
    vi.spyOn(sdk, 'competitionsControllerFindAll').mockResolvedValue(
      page([
        competition(),
        competition({ id: 'c2', title: 'Coupe de Paris' }),
        competition({ id: 'c3', title: 'Trophée de Nantes' }),
        competition({ id: 'c4', title: 'Gala de Lille' }),
      ]) as never,
    );
    const status = mockStatuses([
      { competitionId: 'c1', eventCount: 3, eventsWithResults: 3, resultsStatus: 'COMPLETE' },
      { competitionId: 'c2', eventCount: 5, eventsWithResults: 2, resultsStatus: 'PARTIAL' },
      { competitionId: 'c3', eventCount: 4, eventsWithResults: 0, resultsStatus: 'NONE' },
    ]);
    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Résultats' })).toBeInTheDocument();
    expect((await within(table).findByText('Importés')).closest('[title]')).toHaveAttribute(
      'title',
      '3 épreuves sur 3 avec résultats',
    );
    expect(within(table).getByText('Partiels 2/5')).toBeInTheDocument();
    expect(within(table).getByText('Aucun')).toBeInTheDocument();
    expect(status).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith({ query: { ids: ['c1', 'c2', 'c3', 'c4'] } });
  });

  it('still lists the competitions when the results status cannot be loaded', async () => {
    vi.spyOn(sdk, 'competitionsControllerFindAll').mockResolvedValue(
      page([competition()]) as never,
    );
    vi.spyOn(sdk, 'adminCompetitionsControllerResultsStatusList').mockResolvedValue({
      data: undefined,
      error: { message: 'Erreur serveur' },
    } as never);
    renderPage();
    expect(await screen.findByRole('link', { name: 'Open de Lyon' })).toBeInTheDocument();
    expect(screen.queryByText('Importés')).not.toBeInTheDocument();
  });
});
