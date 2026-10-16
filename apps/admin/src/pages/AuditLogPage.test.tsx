import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { openColumnFilter, sortButton } from '../test/dataTable';
import { pickOption, renderWithProviders, setupUser } from '../test/render';
import { AuditLogPage } from './AuditLogPage';

describe('AuditLogPage', () => {
  it('lists entries with author, action label and a link to the target user', async () => {
    vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
      data: {
        data: [
          {
            id: 'l1',
            action: 'USER_UPDATE',
            targetType: 'USER',
            targetId: 'u1',
            before: { lastName: 'Martin' },
            after: { lastName: 'Durand' },
            actorId: 'a1',
            actorName: 'Gabin S',
            createdAt: '2026-10-07T10:00:00.000Z',
          },
        ],
        meta: { total: 1, skip: 0, take: 50, hasMore: false },
      },
      error: undefined,
    } as never);
    render(
      <MantineProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <AuditLogPage />
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(await screen.findByText('Gabin S')).toBeInTheDocument();
    expect(screen.getByText('Modification de fiche')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /voir la fiche/i })).toHaveAttribute(
      'href',
      '/users/u1',
    );
    expect(screen.getByText('Durand')).toBeInTheDocument();
  });

  it('links a results import to the competition page (#652, #690)', async () => {
    vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
      data: {
        data: [
          {
            id: 'l9',
            action: 'COMPETITION_RESULTS_IMPORT',
            targetType: 'COMPETITION',
            targetId: 'comp-1',
            before: null,
            after: { created: 4 },
            actorId: 'a1',
            actorName: 'Staff S',
            createdAt: '2026-10-16T10:00:00.000Z',
          },
        ],
        meta: { total: 1, skip: 0, take: 50, hasMore: false },
      },
      error: undefined,
    } as never);
    render(
      <MantineProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <AuditLogPage />
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(await screen.findByText('Import des résultats')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('Supprimé')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir la compétition' })).toHaveAttribute(
      'href',
      '/competitions/comp-1',
    );
  });

  it('links club targets to the club page and does not link deleted targets', async () => {
    vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
      data: {
        data: [
          {
            id: 'l2',
            action: 'CLUB_UPDATE',
            targetType: 'CLUB',
            targetId: 'c1',
            before: { name: 'Club A' },
            after: { name: 'Club Z' },
            actorId: 'a1',
            actorName: 'Gabin S',
            createdAt: '2026-10-07T10:00:00.000Z',
          },
          {
            id: 'l3',
            action: 'USER_DELETE',
            targetType: 'USER',
            targetId: 'u9',
            before: null,
            after: { role: 'LICENSEE' },
            actorId: 'a1',
            actorName: 'Gabin S',
            createdAt: '2026-10-07T11:00:00.000Z',
          },
        ],
        meta: { total: 2, skip: 0, take: 50, hasMore: false },
      },
      error: undefined,
    } as never);
    render(
      <MantineProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <AuditLogPage />
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(await screen.findByRole('link', { name: /voir le club/i })).toHaveAttribute(
      'href',
      '/clubs/c1',
    );
    expect(screen.getByText('Supprimé')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /voir la fiche/i })).toBeNull();
  });

  it('links a moderation decision to its proposal, with a French label', async () => {
    vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
      data: {
        data: [
          {
            id: 'l4',
            action: 'TRACK_CORRECTION_REJECT',
            targetType: 'TRACK_CORRECTION',
            targetId: 'c1',
            before: null,
            after: { trackId: 't1' },
            actorId: 'a1',
            actorName: 'Gabin S',
            createdAt: '2026-10-09T10:00:00.000Z',
          },
        ],
        meta: { total: 1, skip: 0, take: 50, hasMore: false },
      },
      error: undefined,
    } as never);
    render(
      <MantineProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <AuditLogPage />
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(await screen.findByText('Proposition refusée')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir la proposition' })).toHaveAttribute(
      'href',
      '/moderation/c1',
    );
    // trackId alone is no change: the proposal link already gives the context.
    expect(screen.queryByText('Musique')).toBeNull();
    expect(screen.queryByText('Champ')).toBeNull();
  });

  it('hides the unchanged trackId of an approval but keeps the real changes', async () => {
    vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
      data: {
        data: [
          {
            id: 'l5',
            action: 'TRACK_CORRECTION_APPROVE',
            targetType: 'TRACK_CORRECTION',
            targetId: 'c2',
            before: { trackId: 't1', bpm: 60 },
            after: { trackId: 't1', bpm: 62 },
            actorId: 'a1',
            actorName: 'Gabin S',
            createdAt: '2026-10-09T10:00:00.000Z',
          },
        ],
        meta: { total: 1, skip: 0, take: 50, hasMore: false },
      },
      error: undefined,
    } as never);
    render(
      <MantineProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <AuditLogPage />
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(await screen.findByText('Proposition approuvée')).toBeInTheDocument();
    expect(screen.getByText('MPM')).toBeInTheDocument();
    expect(screen.queryByText('Musique')).toBeNull();
  });

  it('links a track row to the track page, and shows a deleted track as deleted', async () => {
    vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
      data: {
        data: [
          {
            id: 'l5',
            action: 'TRACK_UPDATE',
            targetType: 'TRACK',
            targetId: 't1',
            before: { blacklisted: false },
            after: { blacklisted: true },
            actorId: 'a1',
            actorName: 'Gabin S',
            createdAt: '2026-10-09T10:00:00.000Z',
          },
          {
            id: 'l6',
            action: 'TRACK_DELETE',
            targetType: 'TRACK',
            targetId: 't2',
            before: { title: 'Rumba', artist: 'Orchestre', sourceKey: null, filename: 'a.mp3' },
            after: null,
            actorId: 'a1',
            actorName: 'Gabin S',
            createdAt: '2026-10-09T10:05:00.000Z',
          },
        ],
        meta: { total: 2, skip: 0, take: 50, hasMore: false },
      },
      error: undefined,
    } as never);
    render(
      <MantineProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <AuditLogPage />
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(await screen.findByText('Modification de musique')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir la musique' })).toHaveAttribute(
      'href',
      '/tracks/t1',
    );
    expect(screen.getByText('Suppression de musique')).toBeInTheDocument();
    expect(screen.getByText('Supprimé')).toBeInTheDocument();
    expect(screen.getByText('Blacklistée')).toBeInTheDocument();
    expect(screen.getByText('Oui')).toBeInTheDocument();
  });
  it('shows the details of a deleted track against empty values', async () => {
    vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
      data: {
        data: [
          {
            id: 'l7',
            action: 'TRACK_DELETE',
            targetType: 'TRACK',
            targetId: 't2',
            before: {
              title: 'Rumba lente',
              artist: 'Orchestre',
              sourceKey: 'k-12',
              filename: 'a.mp3',
            },
            after: null,
            actorId: 'a1',
            actorName: 'Gabin S',
            createdAt: '2026-10-09T10:05:00.000Z',
          },
        ],
        meta: { total: 1, skip: 0, take: 50, hasMore: false },
      },
      error: undefined,
    } as never);
    render(
      <MantineProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <AuditLogPage />
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(await screen.findByText('Suppression de musique')).toBeInTheDocument();
    expect(screen.getByText('Titre')).toBeInTheDocument();
    expect(screen.getByText('Rumba lente')).toBeInTheDocument();
    expect(screen.getByText('Orchestre')).toBeInTheDocument();
    expect(screen.getByText('k-12')).toBeInTheDocument();
    expect(screen.getByText('a.mp3')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(4);
  });
  it('links renewal decisions and shows the granted end of validity as a Paris day', async () => {
    vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
      data: {
        data: [
          {
            id: 'l9',
            action: 'LICENSE_RENEWAL_APPROVE',
            targetType: 'LICENSE_RENEWAL',
            targetId: 'r1',
            before: { status: 'PENDING' },
            after: { status: 'APPROVED', validUntil: '2027-08-31T21:59:59.999Z' },
            actorId: 'a1',
            actorName: 'Gabin S',
            createdAt: '2026-10-10T10:00:00.000Z',
          },
        ],
        meta: { total: 1, skip: 0, take: 50, hasMore: false },
      },
      error: undefined,
    } as never);
    render(
      <MantineProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <AuditLogPage />
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(await screen.findByText('Renouvellement approuvé')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir la demande' })).toHaveAttribute(
      'href',
      '/license-renewals/r1',
    );
    expect(screen.getByText('31/08/2027')).toBeInTheDocument();
    expect(screen.queryByText(/2027-08-31T/)).toBeNull();
  });

  it('filters on the action and the target type, sorts on the date, all in the URL', async () => {
    const user = setupUser();
    const spy = vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
      data: { data: [], meta: { total: 0, skip: 0, take: 50, hasMore: false } },
      error: undefined,
    } as never);
    function Probe() {
      const { pathname, search } = useLocation();
      return <p data-testid="location">{pathname + search}</p>;
    }
    renderWithProviders(
      <>
        <AuditLogPage />
        <Probe />
      </>,
      { route: '/audit?f.targetType=in:CLUB' },
    );
    expect(await screen.findByText('Aucune entrée')).toBeInTheDocument();
    expect(spy).toHaveBeenLastCalledWith({
      query: {
        filters: JSON.stringify([{ field: 'targetType', op: 'in', value: ['CLUB'] }]),
        skip: 0,
        take: 50,
      },
    });
    await openColumnFilter(user, 'Action');
    await pickOption(
      user,
      screen.getByRole('textbox', { name: 'Opérateur : Action' }),
      "n'est aucune de",
    );
    await user.click(screen.getByRole('checkbox', { name: 'Suppression de club' }));
    await user.click(screen.getByRole('button', { name: 'Appliquer le filtre : Action' }));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: {
          filters: JSON.stringify([
            { field: 'targetType', op: 'in', value: ['CLUB'] },
            { field: 'action', op: 'notIn', value: ['CLUB_DELETE'] },
          ]),
          skip: 0,
          take: 50,
        },
      }),
    );
    await user.click(sortButton('Date'));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/audit?f.targetType=in%3ACLUB&f.action=notIn%3ACLUB_DELETE&sort=createdAt&order=asc',
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Réinitialiser les filtres (2)' }));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: { sortBy: 'createdAt', sortOrder: 'asc', skip: 0, take: 50 },
      }),
    );
  });
});
