import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { StatsPage } from './StatsPage';

const buckets = ['2026-09-28', '2026-10-05'];
const zeroRoles = { LICENSEE: 0, CLUB: 0, STAFF: 0, ADMIN: 0 };
const stats = (overrides: Record<string, unknown> = {}) => ({
  generatedAt: '2026-10-10T08:30:00.000Z',
  period: '12w',
  bucket: 'week',
  buckets,
  users: {
    total: 42,
    byRole: { LICENSEE: 30, CLUB: 8, STAFF: 3, ADMIN: 2 },
    neverLoggedIn: 5,
    active7d: 11,
    active30d: 20,
    disabled: 1,
    signups: [
      { start: buckets[0], ...zeroRoles, LICENSEE: 4 },
      { start: buckets[1], ...zeroRoles, CLUB: 8 },
    ],
  },
  licences: {
    valid: 25,
    expiring30d: 2,
    expiring60d: 6,
    expired: 9,
    renewalsPending: 3,
    created: buckets.map((start) => ({ start, count: 1 })),
    clubs: [{ id: 'c1', name: 'Club Un', members: 12, clubAccounts: 1, validLicences: 10 }],
    clubsWithoutClubAccount: 4,
  },
  competitions: {
    byStatus: { UPCOMING: 2, LIVE: 0, PAST: 7, CANCELLED: 1 },
    registrations: buckets.map((start) => ({ start, PENDING: 1, CONFIRMED: 2, CANCELLED: 0 })),
    pastConfirmed: 4,
    pastCheckedIn: 3,
    pastPaid: 2,
  },
  content: {
    tracksByStatus: { READY: 100, PENDING: 2, ERROR: 1 },
    tracksBlacklisted: 3,
    tracksMasked: 5,
    correctionsPending: 6,
    correctionsApproved: 10,
    correctionsRejected: 2,
    medianReviewHours: 6.5,
    corrections: buckets.map((start) => ({
      start,
      TITLE: 1,
      ARTIST: 0,
      DANCE: 0,
      MPM: 1,
      PASO_CLASH: 0,
      OTHER: 0,
    })),
    bugReports: buckets.map((start) => ({ start, count: 0 })),
    adminActions: buckets.map((start) => ({ start, count: 3 })),
  },
  ...overrides,
});

function Probe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderPage(path = '/stats') {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/stats"
              element={
                <>
                  <StatsPage />
                  <Probe />
                </>
              }
            />
            <Route path="/clubs/:id" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const ok = (data: object) => ({ data, error: undefined }) as never;

describe('StatsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the key figures of every block, the clubs table and the history note', async () => {
    vi.spyOn(sdk, 'adminStatsControllerGet').mockResolvedValue(ok(stats()));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Utilisateurs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Licences et clubs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Compétitions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Contenu et modération' })).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('75 % (3 / 4)')).toBeInTheDocument();
    expect(screen.getByText('6,5 h')).toBeInTheDocument();
    expect(screen.getByText('12 inscriptions sur la période')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('link', { name: 'Club Un' })).toHaveAttribute(
      'href',
      '/clubs/c1',
    );
    expect(
      screen.getByText(
        "Les comptes supprimés (dont la purge après 3 ans d'inactivité) ne figurent plus dans les chiffres passés.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Calculé le/)).toBeInTheDocument();
  });

  it('defaults to 12w and puts the chosen period in the URL and the request', async () => {
    const get = vi.spyOn(sdk, 'adminStatsControllerGet').mockResolvedValue(ok(stats()));
    renderPage();
    await screen.findByRole('heading', { name: 'Utilisateurs' });
    expect(get).toHaveBeenLastCalledWith({ query: { period: '12w' } });
    await userEvent.click(screen.getByRole('radio', { name: '6 mois' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith({ query: { period: '6m' } }));
    expect(screen.getByTestId('location')).toHaveTextContent('/stats?period=6m');
  });

  it('reads the period from the URL', async () => {
    const get = vi
      .spyOn(sdk, 'adminStatsControllerGet')
      .mockResolvedValue(ok(stats({ period: '12m', bucket: 'month' })));
    renderPage('/stats?period=12m');
    await screen.findByRole('heading', { name: 'Utilisateurs' });
    expect(get).toHaveBeenCalledWith({ query: { period: '12m' } });
  });

  it('« Actualiser » refetches', async () => {
    const get = vi.spyOn(sdk, 'adminStatsControllerGet').mockResolvedValue(ok(stats()));
    renderPage();
    await screen.findByRole('heading', { name: 'Utilisateurs' });
    await userEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('shows the shared error alert', async () => {
    vi.spyOn(sdk, 'adminStatsControllerGet').mockResolvedValue({
      data: undefined,
      error: { statusCode: 500 },
    } as never);
    renderPage();
    expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument();
  });

  it('shows « — » for empty rates and median', async () => {
    const base = stats();
    vi.spyOn(sdk, 'adminStatsControllerGet').mockResolvedValue(
      ok({
        ...base,
        competitions: { ...base.competitions, pastConfirmed: 0, pastCheckedIn: 0, pastPaid: 0 },
        content: {
          ...base.content,
          medianReviewHours: null,
          correctionsApproved: 0,
          correctionsRejected: 0,
        },
      }),
    );
    renderPage();
    await screen.findByRole('heading', { name: 'Utilisateurs' });
    expect(screen.getAllByText('—')).toHaveLength(4);
  });
});
