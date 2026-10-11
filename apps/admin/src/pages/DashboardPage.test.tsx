import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import type { AdminStatsDto, AuditLogEntryDto } from '../api/generated/types.gen';
import { useSession } from '../session/sessionStore';
import { DashboardPage, keyFigures } from './DashboardPage';

const stats = {
  generatedAt: '2026-10-11T10:00:00.000Z',
  period: '12w',
  bucket: 'week',
  buckets: [],
  users: {
    total: 120,
    byRole: { LICENSEE: 100, CLUB: 10, STAFF: 5, ADMIN: 5 },
    neverLoggedIn: 7,
    active7d: 42,
    active30d: 80,
    disabled: 2,
    signups: [
      { start: '2026-09-28', LICENSEE: 3, CLUB: 1, STAFF: 0, ADMIN: 0 },
      { start: '2026-10-05', LICENSEE: 2, CLUB: 0, STAFF: 0, ADMIN: 0 },
    ],
  },
  licences: {
    valid: 90,
    expiring30d: 4,
    expiring60d: 9,
    expired: 11,
    renewalsPending: 2,
    created: [],
    clubs: [],
    clubsWithoutClubAccount: 1,
  },
  competitions: {
    byStatus: { UPCOMING: 3, LIVE: 1, PAST: 20, CANCELLED: 0 },
    registrations: [],
    pastConfirmed: 0,
    pastCheckedIn: 0,
    pastPaid: 0,
  },
  content: {
    tracksByStatus: { READY: 0, PENDING: 0, ERROR: 0 },
    tracksBlacklisted: 0,
    tracksMasked: 0,
    correctionsPending: 0,
    correctionsApproved: 0,
    correctionsRejected: 0,
    medianReviewHours: null,
    corrections: [],
    bugReports: [],
    adminActions: [],
  },
} as unknown as AdminStatsDto;

const entry = (over: Partial<AuditLogEntryDto>): AuditLogEntryDto => ({
  id: 'a1',
  action: 'CLUB_CREATE',
  targetType: 'CLUB',
  targetId: 'c1',
  actorId: 'u1',
  actorName: 'Ada Admin',
  createdAt: '2026-10-11T08:30:00.000Z',
  ...over,
});

function mockApi({
  pending = 0,
  renewals = 0,
  audit = [entry({})],
  statsError = false,
}: {
  pending?: number;
  renewals?: number;
  audit?: AuditLogEntryDto[];
  statsError?: boolean;
} = {}) {
  vi.spyOn(sdk, 'trackCorrectionsControllerPendingCount').mockResolvedValue({
    data: { count: pending },
    error: undefined,
  } as never);
  vi.spyOn(sdk, 'adminLicenseRenewalsControllerList').mockResolvedValue({
    data: { data: [], meta: { total: renewals, skip: 0, take: 1, hasMore: false } },
    error: undefined,
  } as never);
  const statsSpy = vi
    .spyOn(sdk, 'adminStatsControllerGet')
    .mockResolvedValue(
      (statsError
        ? { data: undefined, error: { statusCode: 500 } }
        : { data: stats, error: undefined }) as never,
    );
  const auditSpy = vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
    data: { data: audit, meta: { total: audit.length, skip: 0, take: 5, hasMore: false } },
    error: undefined,
  } as never);
  return { statsSpy, auditSpy };
}

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSession.getState().clear();
  });

  it('greets the admin by first name', () => {
    mockApi();
    useSession.getState().setSession({
      accessToken: 'a',
      refreshToken: 'r',
      user: { id: 'u1', email: 'a@x.fr', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN' },
    });
    renderPage();
    expect(screen.getByRole('heading', { name: 'Tableau de bord' })).toBeInTheDocument();
    expect(screen.getByText('Bonjour Ada')).toBeInTheDocument();
  });

  it('links each queue to its page, with what waits for a decision', async () => {
    mockApi({ pending: 3, renewals: 0 });
    renderPage();
    const corrections = screen.getByRole('link', { name: /^Propositions de correction/ });
    expect(corrections).toHaveAttribute('href', '/moderation');
    expect(await within(corrections).findByText('3')).toBeInTheDocument();
    expect(within(corrections).getByText('En attente de décision')).toBeInTheDocument();
    const renewals = screen.getByRole('link', { name: /^Renouvellements de licence/ });
    expect(renewals).toHaveAttribute('href', '/license-renewals');
    expect(await within(renewals).findByText('Rien à traiter')).toBeInTheDocument();
  });

  it('shows the key figures of the shortest stats period', async () => {
    const { statsSpy } = mockApi();
    renderPage();
    const section = screen.getByRole('region', { name: 'Chiffres clés' });
    expect(await within(section).findByText('Comptes')).toBeInTheDocument();
    expect(within(section).getByText('120')).toBeInTheDocument();
    expect(statsSpy).toHaveBeenCalledWith({ query: { period: '12w' } });
    expect(within(section).getByRole('link', { name: 'Voir les statistiques' })).toHaveAttribute(
      'href',
      '/stats',
    );
  });

  it('says the figures are unavailable when the stats fail', async () => {
    mockApi({ statsError: true });
    renderPage();
    const section = screen.getByRole('region', { name: 'Chiffres clés' });
    expect(await within(section).findByRole('alert')).toBeInTheDocument();
  });

  it('lists the 5 latest actions with their author', async () => {
    const { auditSpy } = mockApi({
      audit: [entry({}), entry({ id: 'a2', action: 'USER_DELETE', actorName: null })],
    });
    renderPage();
    const section = screen.getByRole('region', { name: 'Activité récente' });
    expect(await within(section).findByText('Création de club')).toBeInTheDocument();
    expect(within(section).getByText('Ada Admin')).toBeInTheDocument();
    expect(within(section).getByText("Suppression d'utilisateur")).toBeInTheDocument();
    expect(within(section).getByText('Système')).toBeInTheDocument();
    expect(auditSpy).toHaveBeenCalledWith({ query: { skip: 0, take: 5 } });
    expect(within(section).getByRole('link', { name: 'Voir le journal' })).toHaveAttribute(
      'href',
      '/audit-log',
    );
  });

  it('says when no action was recorded yet', async () => {
    mockApi({ audit: [] });
    renderPage();
    expect(await screen.findByText('Aucune action enregistrée')).toBeInTheDocument();
  });

  it('offers the shortcuts', () => {
    mockApi();
    renderPage();
    expect(screen.getByRole('link', { name: 'Nouvel utilisateur' })).toHaveAttribute(
      'href',
      '/users/new',
    );
    expect(screen.getByRole('link', { name: 'Nouveau club' })).toHaveAttribute(
      'href',
      '/clubs/new',
    );
    expect(screen.getByRole('link', { name: 'Importer des musiques' })).toHaveAttribute(
      'href',
      '/tracks/import',
    );
  });
});

describe('keyFigures', () => {
  it('counts live competitions as upcoming and sums the signups of the period', () => {
    const figures = Object.fromEntries(keyFigures(stats).map((f) => [f.label, f.value]));
    expect(figures['Compétitions à venir']).toBe(4);
    expect(figures['Inscriptions sur 12 semaines']).toBe(6);
    expect(figures['Licences expirant sous 30 jours']).toBe(4);
  });
});
