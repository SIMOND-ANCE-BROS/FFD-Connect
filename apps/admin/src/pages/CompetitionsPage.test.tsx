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

function renderPage(path = '/competitions') {
  return renderWithProviders(
    <Routes>
      <Route path="/competitions" element={<CompetitionsPage />} />
    </Routes>,
    { route: path },
  );
}

describe('CompetitionsPage', () => {
  beforeEach(() => vi.restoreAllMocks());

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
});
