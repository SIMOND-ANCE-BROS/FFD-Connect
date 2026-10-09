import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { ModerationPage } from './ModerationPage';

const item = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  trackId: 't1',
  reason: 'MPM',
  status: 'PENDING',
  proposed: { title: null, artist: null, style: null, bpm: 62, clashTimecodes: null },
  message: null,
  reviewComment: null,
  reviewedAt: null,
  createdAt: '2026-10-06T10:00:00.000Z',
  track: {
    id: 't1',
    title: 'España Cañí',
    artist: 'Orchestre',
    style: 'Paso Doble',
    bpm: 60,
    clashTimecodes: [40, 80],
    titleMasked: false,
    blacklisted: false,
    filename: 'espana.mp3',
  },
  resultingBpm: 62,
  proposer: { id: 'u1', name: 'Eva Martin' },
  reviewer: null,
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

function renderPage(path = '/moderation') {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/moderation"
              element={
                <>
                  <ModerationPage />
                  <Probe />
                </>
              }
            />
            <Route path="/moderation/:id" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const location = () => screen.getByTestId('location').textContent;

describe('ModerationPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the pending queue by default, with track, reason, proposer and summary', async () => {
    const spy = vi
      .spyOn(sdk, 'trackCorrectionsControllerList')
      .mockResolvedValue(page([item()]) as never);
    renderPage();
    const row = (await screen.findByText('España Cañí')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Orchestre')).toBeInTheDocument();
    expect(within(row).getByText('MPM')).toBeInTheDocument();
    expect(within(row).getByText('Eva Martin')).toBeInTheDocument();
    expect(within(row).getByText('MPM 62')).toBeInTheDocument();
    expect(screen.getByText('1 proposition')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith({ query: { status: 'PENDING', skip: 0, take: 50 } });
  });

  it('flags a masked title next to the real one', async () => {
    vi.spyOn(sdk, 'trackCorrectionsControllerList').mockResolvedValue(
      page([item({ track: { ...item().track, titleMasked: true } })]) as never,
    );
    renderPage();
    const row = (await screen.findByText('España Cañí')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Titre masqué')).toBeInTheDocument();
  });

  it('restores status, reasons, search and page from the URL', async () => {
    const spy = vi
      .spyOn(sdk, 'trackCorrectionsControllerList')
      .mockResolvedValue(page([item()]) as never);
    renderPage('/moderation?status=APPROVED&reason=MPM,TITLE&q=paso&page=2');
    await screen.findByText('España Cañí');
    expect(spy).toHaveBeenCalledWith({
      query: { status: 'APPROVED', reason: ['MPM', 'TITLE'], q: 'paso', skip: 50, take: 50 },
    });
    expect(screen.getByRole('checkbox', { name: 'MPM' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Titre' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Danse' })).not.toBeChecked();
    expect(screen.getByPlaceholderText('Titre ou artiste')).toHaveValue('paso');
  });

  it('filters on the status and the reasons, from the first page, in the URL', async () => {
    const spy = vi
      .spyOn(sdk, 'trackCorrectionsControllerList')
      .mockResolvedValue(page([item()]) as never);
    renderPage('/moderation?page=3');
    await screen.findByText('España Cañí');
    await userEvent.click(screen.getByText('Refusées'));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: { status: 'REJECTED', skip: 0, take: 50 },
      }),
    );
    expect(location()).toBe('/moderation?status=REJECTED');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Clashes paso' }));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: { status: 'REJECTED', reason: ['PASO_CLASH'], skip: 0, take: 50 },
      }),
    );
    expect(location()).toBe('/moderation?status=REJECTED&reason=PASO_CLASH');
  });

  it('does not send a one-letter search, then sends the debounced search', async () => {
    const spy = vi
      .spyOn(sdk, 'trackCorrectionsControllerList')
      .mockResolvedValue(page([item()]) as never);
    renderPage();
    await screen.findByText('España Cañí');
    const input = screen.getByPlaceholderText('Titre ou artiste');
    await userEvent.type(input, 'p');
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(spy).not.toHaveBeenCalledWith({ query: expect.objectContaining({ q: 'p' }) });
    await userEvent.type(input, 'a');
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: { status: 'PENDING', q: 'pa', skip: 0, take: 50 },
      }),
    );
    expect(location()).toBe('/moderation?q=pa');
  });

  it('opens a row with the current filters kept in the URL', async () => {
    vi.spyOn(sdk, 'trackCorrectionsControllerList').mockResolvedValue(page([item()]) as never);
    renderPage('/moderation?reason=MPM');
    await userEvent.click(await screen.findByText('España Cañí'));
    expect(location()).toBe('/moderation/c1?reason=MPM');
  });

  it('shows only the shared alert when the server is unreachable', async () => {
    vi.spyOn(sdk, 'trackCorrectionsControllerList').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
    } as never);
    renderPage();
    expect(
      await screen.findByText('Serveur injoignable, réessayez dans un instant.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
