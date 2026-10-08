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
});
