import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
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
});
