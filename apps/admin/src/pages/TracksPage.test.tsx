import { screen, waitFor, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { renderWithProviders, setupUser, sleep } from '../test/render';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { columnFilterButton, openColumnFilter, sortButton } from '../test/dataTable';
import { mockPhoneViewport } from '../test/viewport';
import { TracksPage } from './TracksPage';

const track = (overrides: Record<string, unknown> = {}) => ({
  id: 't1',
  title: 'España Cañí',
  artist: 'Orchestre',
  style: 'Paso Doble',
  bpm: 60,
  rawBpm: 120,
  clashTimecodes: [40],
  blacklisted: true,
  status: 'ERROR',
  sourceKey: null,
  filename: 'a.mp3',
  artwork: null,
  createdAt: '2026-10-09T10:00:00.000Z',
  pendingCorrections: 0,
  ...overrides,
});

const page = (data: object[]) => ({
  data: { data, meta: { total: data.length, skip: 0, take: 50, hasMore: false } },
  error: undefined,
});

function Probe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderPage(path = '/tracks') {
  return renderWithProviders(
    <Routes>
      <Route
        path="/tracks"
        element={
          <>
            <TracksPage />
            <Probe />
          </>
        }
      />
      <Route path="/tracks/import" element={<Probe />} />
      <Route path="/tracks/:id" element={<Probe />} />
    </Routes>,
    { route: path },
  );
}

let user: UserEvent;

describe('TracksPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    user = setupUser();
  });

  it('shows every track with its badges, a link per title and the import button', async () => {
    vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([track()]) as never);
    renderPage();
    const link = await screen.findByRole('link', { name: 'España Cañí' });
    expect(link).toHaveAttribute('href', '/tracks/t1');
    const table = screen.getByRole('table');
    expect(within(table).queryByText('Titre masqué')).not.toBeInTheDocument();
    expect(within(table).getByText('Blacklistée')).toBeInTheDocument();
    expect(within(table).getByText('En erreur')).toBeInTheDocument();
    expect(within(table).getByText('Paso Doble')).toBeInTheDocument();
    expect(within(table).getByText('09/10/2026')).toBeInTheDocument();
    expect(screen.getByText('1 musique')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Importer des musiques' })).toHaveAttribute(
      'href',
      '/tracks/import',
    );
  });

  it('restores the filters from the URL and sends them to the API', async () => {
    const list = vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([]) as never);
    renderPage('/tracks?status=ERROR&blacklisted=true&style=Rumba&q=paso&page=2');
    await screen.findByText('Aucune musique');
    expect(list).toHaveBeenCalledWith({
      query: { q: 'paso', status: 'ERROR', blacklisted: true, style: 'Rumba', skip: 50, take: 50 },
    });
    await openColumnFilter(user, 'Titre');
    expect(screen.getByRole('checkbox', { name: 'Blacklistées' })).toBeChecked();
    await openColumnFilter(user, 'Danse');
    expect(screen.getByRole('checkbox', { name: 'Ambiance' })).not.toBeChecked();
    await openColumnFilter(user, 'Statut');
    expect(screen.getByRole('radio', { name: 'En erreur' })).toBeChecked();
  });

  it('puts a header filter in the URL and goes back to the first page', async () => {
    const list = vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([]) as never);
    renderPage('/tracks?page=3');
    await screen.findByText('Aucune musique');
    await openColumnFilter(user, 'Danse');
    await user.click(screen.getByRole('checkbox', { name: 'Ambiance' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/tracks?ambiance=true'),
    );
    expect(list).toHaveBeenLastCalledWith({ query: { ambiance: true, skip: 0, take: 50 } });
  });

  it('filters on a status', async () => {
    const list = vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([]) as never);
    renderPage();
    await screen.findByText('Aucune musique');
    await openColumnFilter(user, 'Statut');
    await user.click(screen.getByRole('radio', { name: 'En attente' }));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ query: { status: 'PENDING', skip: 0, take: 50 } }),
    );
  });

  it('does not send a one-letter search, then sends the debounced search', async () => {
    const list = vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([]) as never);
    renderPage();
    await screen.findByText('Aucune musique');
    const search = screen.getByRole('textbox', { name: 'Rechercher' });
    await user.type(search, 'p');
    await sleep(400);
    expect(list).not.toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ q: 'p' }) }),
    );
    await user.type(search, 'a');
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ query: { q: 'pa', skip: 0, take: 50 } }),
    );
  });

  it('caps the search at the API limit, so the input and the URL never disagree', async () => {
    vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([]) as never);
    renderPage();
    await screen.findByText('Aucune musique');
    expect(screen.getByRole('textbox', { name: 'Rechercher' })).toHaveAttribute('maxlength', '100');
  });

  it('shows only the shared alert when the server is unreachable', async () => {
    vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
    } as never);
    renderPage();
    expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('on a phone, counts the folded filters restored from the URL and resets them', async () => {
    mockPhoneViewport();
    const list = vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([]) as never);
    renderPage('/tracks?status=ERROR&blacklisted=true&style=Rumba&q=paso');
    await screen.findByText('Aucune musique');
    expect(screen.getByRole('textbox', { name: 'Rechercher' })).toBeVisible();
    // Status, one flag and the dance; the search is not a folded filter.
    await user.click(screen.getByRole('button', { name: 'Filtres (3)' }));
    expect(screen.getByLabelText('Blacklistées')).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Réinitialiser les filtres (3)' }));
    expect(await screen.findByRole('button', { name: 'Filtres' })).toBeInTheDocument();
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ query: { q: 'paso', skip: 0, take: 50 } }),
    );
  });

  it('on a desktop, puts the filters in the column headers and flags the active ones', async () => {
    vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([]) as never);
    renderPage('/tracks?style=Rumba');
    await screen.findByText('Aucune musique');
    expect(screen.queryByRole('button', { name: /^Filtres/ })).toBeNull();
    // Closed menus: the filter controls only appear once a header menu opens.
    expect(screen.queryByText('Blacklistées')).toBeNull();
    expect(columnFilterButton('Danse')).toHaveAccessibleName('Filtrer : Danse (filtre actif)');
    expect(columnFilterButton('Titre')).toHaveAccessibleName('Filtrer : Titre');
    await openColumnFilter(user, 'Titre');
    expect(screen.getByText('Blacklistées')).toBeVisible();
  });

  it('sorts the whole catalogue from a header: ascending, descending, then default', async () => {
    const list = vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([]) as never);
    renderPage('/tracks?page=2');
    await screen.findByText('Aucune musique');
    await user.click(sortButton('MPM'));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/tracks?sort=bpm&order=asc'),
    );
    expect(list).toHaveBeenLastCalledWith({
      query: { sortBy: 'bpm', sortOrder: 'asc', skip: 0, take: 50 },
    });
    expect(screen.getByRole('columnheader', { name: /^MPM/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await user.click(sortButton('MPM'));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({
        query: { sortBy: 'bpm', sortOrder: 'desc', skip: 0, take: 50 },
      }),
    );
    await user.click(sortButton('MPM'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/tracks$/));
    expect(list).toHaveBeenLastCalledWith({ query: { skip: 0, take: 50 } });
  });
});
