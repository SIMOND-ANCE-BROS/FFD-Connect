import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { ClubsPage } from './ClubsPage';

const page = {
  data: {
    data: [
      {
        id: 'c1',
        name: 'Club A',
        registrationMode: 'CLUB_ONLY',
        disabledAt: null,
        memberCount: 12,
        clubAccountCount: 1,
        helloAssoConfigured: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'c2',
        name: 'Club B',
        registrationMode: 'MEMBERS_AUTO_CONFIRM',
        disabledAt: '2026-10-01T00:00:00.000Z',
        memberCount: 0,
        clubAccountCount: 0,
        helloAssoConfigured: false,
        createdAt: '2026-02-01T00:00:00.000Z',
      },
    ],
    meta: { total: 2, skip: 0, take: 50, hasMore: false },
  },
  error: undefined,
};

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <ClubsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe('ClubsPage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('lists clubs with their counts, HelloAsso badge, mode and status', async () => {
    vi.spyOn(sdk, 'adminControllerListClubs').mockResolvedValue(page as never);
    renderPage();
    const rowA = (await screen.findByRole('link', { name: 'Club A' })).closest('tr') as HTMLElement;
    expect(screen.getByRole('link', { name: 'Club A' })).toHaveAttribute('href', '/clubs/c1');
    expect(within(rowA).getByText('12')).toBeInTheDocument();
    expect(within(rowA).getByText('HelloAsso')).toBeInTheDocument();
    expect(within(rowA).getByText('Le club seul inscrit ses licenciés')).toBeInTheDocument();
    const rowB = screen.getByRole('link', { name: 'Club B' }).closest('tr') as HTMLElement;
    expect(within(rowB).getByText('Désactivé')).toBeInTheDocument();
    expect(within(rowB).queryByText('HelloAsso')).toBeNull();
    expect(screen.getByText('2 clubs')).toBeInTheDocument();
  });

  it('searches by name after debounce and filters on the status, from the first page', async () => {
    const spy = vi.spyOn(sdk, 'adminControllerListClubs').mockResolvedValue(page as never);
    renderPage();
    await screen.findByRole('link', { name: 'Club A' });
    await userEvent.type(screen.getByPlaceholderText(/nom du club/i), 'cl');
    await userEvent.click(screen.getByText('Désactivés'));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ search: 'cl', status: 'disabled', skip: 0 }),
      }),
    );
  });

  it('shows an error state when the API fails', async () => {
    vi.spyOn(sdk, 'adminControllerListClubs').mockResolvedValue({
      data: undefined,
      error: { message: 'x' },
    } as never);
    renderPage();
    expect(await screen.findByText(/impossible de charger les clubs/i)).toBeInTheDocument();
  });
});
