import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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
        extraRoles: [],
        roles: ['LICENSEE'],
        clubId: 'c1',
        clubName: 'Club A',
        category: 'Latin',
        ageGroup: 'Adulte',
        licenseStatus: 'ACTIVE',
        disabledAt: null,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      {
        id: 'u2',
        email: 'paul@x.fr',
        firstName: 'Paul',
        lastName: 'Durand',
        role: 'LICENSEE',
        extraRoles: [],
        roles: ['LICENSEE'],
        clubId: null,
        clubName: null,
        category: null,
        ageGroup: null,
        licenseStatus: null,
        disabledAt: '2026-10-01T00:00:00.000Z',
        createdAt: '2026-09-02T00:00:00.000Z',
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
    vi.spyOn(sdk, 'adminControllerClubOptions').mockResolvedValue({
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
    vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(2) as never);
    renderPage();
    expect(await screen.findByText('jeanne@x.fr')).toBeInTheDocument();
    expect(screen.getByText('2 utilisateurs')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Utilisateurs' })).toBeInTheDocument();
  });

  it('renders a dash for null club, category, age group and license', async () => {
    vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(2) as never);
    renderPage();
    const row = (await screen.findByText('paul@x.fr')).closest('tr') as HTMLElement;
    expect(within(row).getAllByText('—')).toHaveLength(5);
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
    expect(await screen.findByText('x')).toBeInTheDocument();
    expect(screen.queryByText(/\d+ utilisateurs?$/)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('flags a disabled user with a red badge', async () => {
    vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(2) as never);
    renderPage();
    const row = (await screen.findByText('paul@x.fr')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Désactivé')).toBeInTheDocument();
    const other = screen.getByText('jeanne@x.fr').closest('tr') as HTMLElement;
    expect(within(other).queryByText('Désactivé')).toBeNull();
  });

  it('badges the store-review account', async () => {
    const p = page(2);
    const [a, b] = p.data.data;
    vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue({
      ...p,
      data: { ...p.data, data: [{ ...a, isStoreReview: true }, b] },
    } as never);
    renderPage();
    const row = (await screen.findByText('jeanne@x.fr')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Validation stores')).toBeInTheDocument();
    const other = screen.getByText('paul@x.fr').closest('tr') as HTMLElement;
    expect(within(other).queryByText('Validation stores')).toBeNull();
  });

  it('filters on the status, from the first page', async () => {
    const spy = vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(1) as never);
    renderPage();
    await screen.findByText('jeanne@x.fr');
    await userEvent.click(screen.getByText('Désactivés'));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ status: 'disabled', skip: 0 }),
      }),
    );
  });

  it('shows a badge per extra role', async () => {
    const res = page(1);
    res.data.data[0] = {
      ...res.data.data[0],
      extraRoles: ['CLUB'],
      roles: ['LICENSEE', 'CLUB'],
    } as never;
    vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(res as never);
    renderPage();
    expect((await screen.findAllByText('Licencié')).length).toBeGreaterThan(0);
    expect(screen.getByText('+ Club')).toBeInTheDocument();
  });

  it('shows the main role and the extra roles in two columns', async () => {
    const res = page(1);
    res.data.data[0] = {
      ...res.data.data[0],
      extraRoles: ['CLUB', 'STAFF'],
      roles: ['LICENSEE', 'CLUB', 'STAFF'],
    } as never;
    vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(res as never);
    renderPage();
    await screen.findByText('jeanne@x.fr');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toContain('Rôle principal');
    expect(headers).toContain('Rôles supplémentaires');
    expect(headers).not.toContain('Rôle');

    const withExtras = screen.getByText('jeanne@x.fr').closest('tr') as HTMLElement;
    const cells = within(withExtras).getAllByRole('cell');
    const main = headers.indexOf('Rôle principal');
    const extra = headers.indexOf('Rôles supplémentaires');
    expect(within(cells[main]).getByText('Licencié')).toBeInTheDocument();
    expect(within(cells[extra]).getByText('+ Club')).toBeInTheDocument();
    expect(within(cells[extra]).getByText('+ Staff')).toBeInTheDocument();

    const without = screen.getByText('paul@x.fr').closest('tr') as HTMLElement;
    expect(within(within(without).getAllByRole('cell')[extra]).getByText('—')).toBeInTheDocument();
  });
});
