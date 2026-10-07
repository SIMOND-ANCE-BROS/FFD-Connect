import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { UsersPage } from './UsersPage';

const page = (n: number) => ({
  data: {
    data: [
      {
        id: 'u1',
        email: 'jeanne@x.fr',
        firstName: 'Jeanne',
        lastName: 'Martin',
        role: 'LICENSEE',
        clubId: 'c1',
        clubName: 'Club A',
        category: 'Latin',
        ageGroup: 'Adulte',
        licenseStatus: 'ACTIVE',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
    meta: { total: n, skip: 0, take: 50, hasMore: n > 50 },
  },
  error: undefined,
});

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <UsersPage />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe('UsersPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sdk, 'adminControllerClubs').mockResolvedValue({
      data: [{ id: 'c1', name: 'Club A' }],
      error: undefined,
    } as never);
    vi.spyOn(sdk, 'adminControllerReferenceData').mockResolvedValue({
      data: {
        categories: ['Latin'],
        ageGroups: [],
        competitionLevels: [],
        passportLevels: [],
        roles: ['LICENSEE', 'CLUB', 'STAFF', 'ADMIN'],
      },
      error: undefined,
    } as never);
  });

  it('lists users with the total count', async () => {
    vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(1) as never);
    renderPage();
    expect(await screen.findByText('jeanne@x.fr')).toBeInTheDocument();
    expect(screen.getByText('1 inscrit')).toBeInTheDocument();
  });

  it('sends the search after debounce, from the first page', async () => {
    const spy = vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(1) as never);
    renderPage();
    await screen.findByText('jeanne@x.fr');
    await userEvent.type(screen.getByPlaceholderText(/nom, prénom ou email/i), 'mar');
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ search: 'mar', skip: 0 }),
      }),
    );
  });

  it('shows an error state when the API fails', async () => {
    vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue({
      data: undefined,
      error: { message: 'x' },
    } as never);
    renderPage();
    expect(await screen.findByText(/impossible de charger/i)).toBeInTheDocument();
  });
});
