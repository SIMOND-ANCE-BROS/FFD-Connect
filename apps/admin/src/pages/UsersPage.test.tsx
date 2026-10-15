import { screen, waitFor, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { fill, renderWithProviders, setupUser } from '../test/render';
import { columnFilterButton, openColumnFilter, sortButton } from '../test/dataTable';
import { mockPhoneViewport } from '../test/viewport';
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

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <p data-testid="location">{pathname + search}</p>;
}

function renderPage(route = '/') {
  return renderWithProviders(
    <>
      <UsersPage />
      <LocationProbe />
    </>,
    { route },
  );
}

let user: UserEvent;

describe('UsersPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    user = setupUser();
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

  it('opens a user record with the keyboard and exposes filter labels', async () => {
    vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(2) as never);
    renderPage();
    const link = await screen.findByRole('link', { name: 'Martin Jeanne' });
    expect(screen.getByRole('textbox', { name: 'Rechercher un utilisateur' })).toBeInTheDocument();
    await openColumnFilter(user, 'Inscription');
    expect(screen.getByRole('textbox', { name: 'Opérateur : Inscription' })).toHaveValue(
      'avant le',
    );
    link.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/users/u1');
  });

  it('lists users with the total count', async () => {
    vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(2) as never);
    renderPage();
    expect(await screen.findByText('jeanne@x.fr')).toBeInTheDocument();
    expect(screen.getByText('2 utilisateurs')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Utilisateurs' })).toBeInTheDocument();
  });

  it('shows the discipline in French', async () => {
    vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(2) as never);
    renderPage();
    const row = (await screen.findByText('jeanne@x.fr')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Latines')).toBeInTheDocument();
    expect(within(row).queryByText('Latin')).not.toBeInTheDocument();
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
    await fill(user, screen.getByPlaceholderText(/nom, prénom ou email/i), 'mar');
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

  it('filters on the status with an operator, server-side, from the first page (#557)', async () => {
    const spy = vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(1) as never);
    renderPage('/?page=2');
    await screen.findByText('jeanne@x.fr');
    await openColumnFilter(user, 'Compte');
    const apply = screen.getByRole('button', { name: 'Appliquer le filtre : Compte' });
    // Nothing is sent before a value is chosen.
    expect(apply).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Désactivé' }));
    await user.click(apply);
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: expect.objectContaining({
          filters: JSON.stringify([{ field: 'status', op: 'in', value: ['disabled'] }]),
          skip: 0,
        }),
      }),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/?f.status=in%3Adisabled');
    expect(columnFilterButton('Compte')).toHaveAccessibleName('Filtrer : Compte (filtre actif)');

    // The active filter is a chip, removed in one click.
    await user.click(
      screen.getByRole('button', {
        name: "Retirer le filtre : Compte est l'une de Désactivé",
      }),
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
    expect(spy).toHaveBeenLastCalledWith({
      query: expect.not.objectContaining({ filters: expect.anything() }),
    });
  });

  it('combines a text operator with another filter (AND)', async () => {
    const spy = vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(1) as never);
    renderPage('/?f.club=isEmpty');
    await screen.findByText('jeanne@x.fr');
    await openColumnFilter(user, 'Email');
    await user.click(screen.getByRole('textbox', { name: 'Opérateur : Email' }));
    await user.click(screen.getByRole('option', { name: 'ne contient pas' }));
    await fill(user, screen.getByRole('textbox', { name: 'Valeur : Email' }), '@club.fr');
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: expect.objectContaining({
          filters: JSON.stringify([
            { field: 'club', op: 'isEmpty' },
            { field: 'email', op: 'notContains', value: '@club.fr' },
          ]),
        }),
      }),
    );
    expect(screen.getByRole('group', { name: 'Filtres actifs' })).toHaveTextContent(
      'Club est vide',
    );
    expect(screen.getByRole('group', { name: 'Filtres actifs' })).toHaveTextContent(
      'Email ne contient pas « @club.fr »',
    );
  });

  describe('on a phone', () => {
    beforeEach(() => mockPhoneViewport());

    it('keeps the search visible and folds the other filters', async () => {
      vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(2) as never);
      renderPage();
      expect(await screen.findByText('jeanne@x.fr')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/nom, prénom ou email/i)).toBeVisible();
      const toggle = screen.getByRole('button', { name: 'Filtres' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(
        screen.getByLabelText('Opérateur : Rôle (principal ou supplémentaire)'),
      ).toBeInTheDocument();
      // Cards, not the desktop table.
      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.getByRole('link', { name: /Martin Jeanne/ })).toHaveAttribute(
        'href',
        '/users/u1',
      );
    });

    it('counts the active filters and resets them', async () => {
      const spy = vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(1) as never);
      renderPage();
      await screen.findByText('jeanne@x.fr');
      await user.click(screen.getByRole('button', { name: 'Filtres' }));
      // The folded panel is still opening: label queries, not the accessibility tree.
      await user.click(screen.getByLabelText('Désactivé'));
      await user.click(
        screen.getByRole('button', { name: 'Appliquer le filtre : Compte', hidden: true }),
      );
      expect(await screen.findByRole('button', { name: 'Filtres (1)' })).toBeInTheDocument();
      await waitFor(() =>
        expect(spy).toHaveBeenLastCalledWith({
          query: expect.objectContaining({ filters: expect.stringContaining('"status"') }),
        }),
      );
      // The search is always visible: it never counts as a folded filter.
      await fill(user, screen.getByPlaceholderText(/nom, prénom ou email/i), 'mar');
      expect(screen.getByRole('button', { name: 'Filtres (1)' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Réinitialiser les filtres (1)' }));
      expect(await screen.findByRole('button', { name: 'Filtres' })).toBeInTheDocument();
      await waitFor(() =>
        expect(spy).toHaveBeenLastCalledWith({
          query: expect.not.objectContaining({ filters: expect.anything() }),
        }),
      );
    });
  });

  it('on a desktop, puts the filters in the column headers, without a « Filtres » button', async () => {
    vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(2) as never);
    renderPage();
    await screen.findByText('jeanne@x.fr');
    expect(screen.queryByRole('button', { name: /^Filtres/ })).toBeNull();
    const roleOperator = { name: 'Opérateur : Rôle (principal ou supplémentaire)' };
    expect(screen.queryByRole('textbox', roleOperator)).toBeNull();
    await openColumnFilter(user, 'Rôle principal');
    expect(screen.getByRole('textbox', roleOperator)).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Club' })).toBeVisible();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('restores filters, sort and page from the URL and sends them to the API', async () => {
    const spy = vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(120) as never);
    renderPage(
      '/?q=mar&f.role=in:CLUB&f.category=contains:lat&f.lastLoginAt=isEmpty&f.createdAt=between:2026-09-01,2026-09-30&sort=name&order=desc&page=2',
    );
    await screen.findByText('jeanne@x.fr');
    expect(spy).toHaveBeenCalledWith({
      query: {
        search: 'mar',
        filters: JSON.stringify([
          { field: 'role', op: 'in', value: ['CLUB'] },
          { field: 'category', op: 'contains', value: 'lat' },
          { field: 'lastLoginAt', op: 'isEmpty' },
          { field: 'createdAt', op: 'between', value: ['2026-09-01', '2026-09-30'] },
        ]),
        sortBy: 'name',
        sortOrder: 'desc',
        skip: 50,
        take: 50,
      },
    });
    expect(screen.getByRole('textbox', { name: 'Rechercher un utilisateur' })).toHaveValue('mar');
    expect(screen.getByRole('columnheader', { name: 'Nom' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    // A filtered column is shown even when hidden by default (lastLoginAt).
    expect(screen.getByRole('columnheader', { name: /Dernière connexion/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Réinitialiser les filtres (4)' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/?q=mar&sort=name&order=desc'),
    );
  });

  it('restores several conditions of one column from the URL, with their chips (#673)', async () => {
    const spy = vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(120) as never);
    renderPage('/?f.email=contains:gmail&f.email=contains:hotmail&j.email=or&f.role=in:CLUB');
    await screen.findByText('jeanne@x.fr');
    expect(spy).toHaveBeenCalledWith({
      query: {
        filters: JSON.stringify([
          { field: 'email', op: 'contains', value: 'gmail', join: 'or' },
          { field: 'email', op: 'contains', value: 'hotmail', join: 'or' },
          { field: 'role', op: 'in', value: ['CLUB'] },
        ]),
        skip: 0,
        take: 50,
      },
    });
    const chips = screen.getByRole('group', { name: 'Filtres actifs' });
    expect(within(chips).getByText('ou Email contient « hotmail »')).toBeInTheDocument();
    await user.click(
      within(chips).getByRole('button', { name: 'Retirer le filtre : Email contient « gmail »' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/?f.email=contains%3Ahotmail&f.role=in%3ACLUB',
      ),
    );
  });

  it('sorts the whole list from a header, from the first page', async () => {
    const spy = vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(120) as never);
    renderPage('/?page=3');
    await screen.findByText('jeanne@x.fr');
    await user.click(sortButton('Club'));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: { sortBy: 'club', sortOrder: 'asc', skip: 0, take: 50 },
      }),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/?sort=club&order=asc');
  });

  it('offers the licence number and the last login as optional columns', async () => {
    const res = page(1);
    res.data.data[0] = {
      ...res.data.data[0],
      licenseNumber: 'FFD-42',
      lastLoginAt: '2026-10-01T08:00:00.000Z',
    } as never;
    vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(res as never);
    renderPage();
    await screen.findByText('jeanne@x.fr');
    expect(screen.queryByText('FFD-42')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Colonnes' }));
    await user.click(screen.getByRole('checkbox', { name: 'N° de licence' }));
    await user.click(screen.getByRole('checkbox', { name: 'Dernière connexion' }));
    expect(screen.getByText('FFD-42')).toBeInTheDocument();
    expect(screen.getByText('01/10/2026')).toBeInTheDocument();
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
