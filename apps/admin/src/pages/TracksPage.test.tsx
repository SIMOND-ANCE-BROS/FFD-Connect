import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { TracksPage } from './TracksPage';

const track = (overrides: Record<string, unknown> = {}) => ({
  id: 't1',
  title: 'España Cañí',
  artist: 'Orchestre',
  style: 'Paso Doble',
  bpm: 60,
  rawBpm: 120,
  clashTimecodes: [40],
  titleMasked: true,
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
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
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
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe('TracksPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows every track with its badges, a link per title and the import button', async () => {
    vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([track()]) as never);
    renderPage();
    const link = await screen.findByRole('link', { name: 'España Cañí' });
    expect(link).toHaveAttribute('href', '/tracks/t1');
    const table = screen.getByRole('table');
    expect(within(table).getByText('Titre masqué')).toBeInTheDocument();
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
    expect(screen.getByRole('checkbox', { name: 'Blacklistées' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Ambiance' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'En erreur' })).toBeChecked();
  });

  it('puts a chip in the URL and goes back to the first page', async () => {
    const list = vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([]) as never);
    renderPage('/tracks?page=3');
    await screen.findByText('Aucune musique');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ambiance' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/tracks?ambiance=true'),
    );
    expect(list).toHaveBeenLastCalledWith({ query: { ambiance: true, skip: 0, take: 50 } });
  });

  it('filters on a status', async () => {
    const list = vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([]) as never);
    renderPage();
    await screen.findByText('Aucune musique');
    await userEvent.click(screen.getByRole('radio', { name: 'En attente' }));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ query: { status: 'PENDING', skip: 0, take: 50 } }),
    );
  });

  it('does not send a one-letter search, then sends the debounced search', async () => {
    const list = vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([]) as never);
    renderPage();
    await screen.findByText('Aucune musique');
    const search = screen.getByRole('textbox', { name: 'Rechercher' });
    await userEvent.type(search, 'p');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(list).not.toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ q: 'p' }) }),
    );
    await userEvent.type(search, 'a');
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ query: { q: 'pa', skip: 0, take: 50 } }),
    );
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
});
