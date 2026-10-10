import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { UsagePage } from './UsagePage';

const grid = () => Array.from({ length: 7 }, () => Array<number>(24).fill(0));
const usage = (o: Record<string, unknown> = {}) => {
  const heatmap = grid();
  heatmap[0][9] = 8; // lun. 9 h
  heatmap[5][14] = 2; // sam. 14 h
  return {
    generatedAt: '2026-10-10T08:30:00.000Z',
    period: '30d',
    from: '2026-09-11',
    to: '2026-10-10',
    bucket: 'day',
    aggregatedUntil: null,
    activeInstallsPerDay: 4.5,
    activeInstallsThisMonth: 21,
    sessions: 37,
    medianSessionMinutes: 7.5,
    platforms: { ios: 30, android: 10 },
    heatmap,
    screens: [
      { screen: 'Competitions', views: 30, durationSec: 900 },
      { screen: 'License', views: 10, durationSec: 60 },
    ],
    events: [
      {
        start: '2026-10-10',
        login: 3,
        login_biometric: 1,
        login_guest: 0,
        register: 1,
        license_scan: 0,
        license_wallet_add: 0,
      },
    ],
    versions: [{ appVersion: '1.4.2', installs: 18 }],
    competitions: [
      { competitionId: 'c1', title: 'Open de Lyon', views: 12 },
      { competitionId: 'c2', title: null, views: 2 },
    ],
    ...o,
  };
};

function Probe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderPage(path = '/usage') {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/usage"
              element={
                <>
                  <UsagePage />
                  <Probe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}
const ok = (data: object) => ({ data, error: undefined }) as never;

describe('UsagePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the figures, the day × hour grid with its accessible table, and the tables', async () => {
    vi.spyOn(sdk, 'adminUsageControllerGet').mockResolvedValue(ok(usage()));
    renderPage();
    expect(await screen.findByText('Installations actives / jour')).toBeInTheDocument();
    expect(screen.getByText('4,5')).toBeInTheDocument();
    const month = screen.getByText('Installations actives ce mois').parentElement as HTMLElement;
    expect(within(month).getByText('21')).toBeInTheDocument();
    expect(screen.getByText('7,5 min')).toBeInTheDocument();
    expect(screen.getByText('75 % / 25 %')).toBeInTheDocument();
    expect(screen.getByTitle('lun. 9 h : 8')).toHaveAttribute('data-level', '4');
    expect(screen.getByTitle('sam. 14 h : 2')).toHaveAttribute('data-level', '1');
    const a11y = screen.getByRole('table', { name: 'Usage par jour et heure' });
    expect(within(a11y).getAllByRole('row')).toHaveLength(8); // header + 7 days
    expect(screen.getByText('Competitions')).toBeInTheDocument();
    expect(screen.getByText('15 min')).toBeInTheDocument(); // 900 s
    expect(screen.getByText('1.4.2')).toBeInTheDocument();
    expect(screen.getByText('Open de Lyon')).toBeInTheDocument();
    expect(screen.getByText('Compétition supprimée')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Données anonymes : un identifiant d'installation renouvelé chaque mois, sans lien avec les comptes. Les utilisateurs qui ont désactivé la mesure d'audience n'apparaissent pas.",
      ),
    ).toBeInTheDocument();
  });

  it('period and space go to the URL and the request', async () => {
    const get = vi.spyOn(sdk, 'adminUsageControllerGet').mockResolvedValue(ok(usage()));
    renderPage();
    await screen.findByText('Installations actives / jour');
    expect(get).toHaveBeenLastCalledWith({ query: { period: '30d' } });
    await userEvent.click(screen.getByRole('radio', { name: '7 jours' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith({ query: { period: '7d' } }));
    await userEvent.click(screen.getByRole('radio', { name: 'Club' }));
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith({ query: { period: '7d', space: 'CLUB' } }),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/usage?period=7d&space=CLUB');
  });

  it('12m shows the aggregation date, « — » for sessions and the 90-day note', async () => {
    vi.spyOn(sdk, 'adminUsageControllerGet').mockResolvedValue(
      ok(
        usage({
          period: '12m',
          bucket: 'month',
          aggregatedUntil: '2026-10-09',
          sessions: null,
          medianSessionMinutes: null,
        }),
      ),
    );
    renderPage('/usage?period=12m');
    expect(await screen.findByText("Données agrégées jusqu'au 09/10/2026")).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('90 derniers jours')).toBeInTheDocument();
  });

  it('an empty period shows the empty state', async () => {
    vi.spyOn(sdk, 'adminUsageControllerGet').mockResolvedValue(
      ok(
        usage({
          heatmap: grid(),
          screens: [],
          versions: [],
          competitions: [],
          sessions: 0,
          medianSessionMinutes: null,
          activeInstallsPerDay: 0,
          activeInstallsThisMonth: 0,
          platforms: { ios: 0, android: 0 },
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText("Aucune donnée d'usage sur la période.")).toBeInTheDocument();
  });

  it('shows the shared error alert', async () => {
    vi.spyOn(sdk, 'adminUsageControllerGet').mockResolvedValue({
      data: undefined,
      error: { statusCode: 500 },
    } as never);
    renderPage();
    expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument();
  });
});
