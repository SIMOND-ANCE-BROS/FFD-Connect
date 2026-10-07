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
});
