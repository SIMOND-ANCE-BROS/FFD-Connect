import { screen, waitFor, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { openColumnFilter, sortButton } from '../test/dataTable';
import { renderWithProviders, setupUser } from '../test/render';
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
        paymentProvider: 'HELLOASSO',
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
        paymentProvider: 'HELLOASSO',
        createdAt: '2026-02-01T00:00:00.000Z',
      },
    ],
    meta: { total: 2, skip: 0, take: 50, hasMore: false },
  },
  error: undefined,
};

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <p data-testid="location">{pathname + search}</p>;
}

function renderPage(route = '/clubs') {
  return renderWithProviders(
    <>
      <ClubsPage />
      <LocationProbe />
    </>,
    { route },
  );
}

let userEvent: UserEvent;

describe('ClubsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    userEvent = setupUser();
  });

  it('lists clubs with their counts, payment connector, mode and status', async () => {
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
    expect(within(rowB).getByText('HelloAsso · non configuré')).toBeInTheDocument();
    expect(screen.getByText('2 clubs')).toBeInTheDocument();
  });

  it('badges the store-review club', async () => {
    const [a, b] = page.data.data;
    vi.spyOn(sdk, 'adminControllerListClubs').mockResolvedValue({
      ...page,
      data: { ...page.data, data: [{ ...a, isStoreReview: true }, b] },
    } as never);
    renderPage();
    const rowA = (await screen.findByRole('link', { name: 'Club A' })).closest('tr') as HTMLElement;
    expect(within(rowA).getByText('Validation stores')).toBeInTheDocument();
    const rowB = screen.getByRole('link', { name: 'Club B' }).closest('tr') as HTMLElement;
    expect(within(rowB).queryByText('Validation stores')).toBeNull();
  });

  it('searches by name after debounce and filters on the status, from the first page', async () => {
    const spy = vi.spyOn(sdk, 'adminControllerListClubs').mockResolvedValue(page as never);
    renderPage();
    await screen.findByRole('link', { name: 'Club A' });
    await userEvent.type(screen.getByPlaceholderText(/nom du club/i), 'cl');
    await openColumnFilter(userEvent, 'Statut');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Désactivé' }));
    await userEvent.click(screen.getByRole('button', { name: 'Appliquer le filtre : Statut' }));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: expect.objectContaining({
          search: 'cl',
          filters: JSON.stringify([{ field: 'status', op: 'in', value: ['disabled'] }]),
          skip: 0,
        }),
      }),
    );
  });

  it('shows an error state when the API fails', async () => {
    vi.spyOn(sdk, 'adminControllerListClubs').mockResolvedValue({
      data: undefined,
      error: { message: 'x' },
    } as never);
    renderPage();
    expect(await screen.findByText('x')).toBeInTheDocument();
    expect(screen.queryByText(/\d+ clubs?$/)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('goes back to the first page when the status filter changes', async () => {
    const big = {
      ...page,
      data: { ...page.data, meta: { total: 120, skip: 0, take: 50, hasMore: true } },
    };
    const spy = vi.spyOn(sdk, 'adminControllerListClubs').mockResolvedValue(big as never);
    renderPage();
    await screen.findByRole('link', { name: 'Club A' });
    await userEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({ query: expect.objectContaining({ skip: 50 }) }),
    );
    await openColumnFilter(userEvent, 'Statut');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Désactivé' }));
    await userEvent.click(screen.getByRole('button', { name: 'Appliquer le filtre : Statut' }));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: expect.objectContaining({
          filters: JSON.stringify([{ field: 'status', op: 'in', value: ['disabled'] }]),
          skip: 0,
        }),
      }),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/clubs?f.status=in%3Adisabled');
  });

  it('sorts on the creation date, kept in the URL', async () => {
    const spy = vi.spyOn(sdk, 'adminControllerListClubs').mockResolvedValue(page as never);
    renderPage('/clubs?q=club');
    await screen.findByRole('link', { name: 'Club A' });
    expect(screen.getByPlaceholderText(/nom du club/i)).toHaveValue('club');
    await userEvent.click(sortButton('Création'));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: { search: 'club', sortBy: 'createdAt', sortOrder: 'asc', skip: 0, take: 50 },
      }),
    );
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/clubs?q=club&sort=createdAt&order=asc',
    );
  });

  it('links to the club creation form', async () => {
    vi.spyOn(sdk, 'adminControllerListClubs').mockResolvedValue(page as never);
    renderPage();
    await screen.findByRole('link', { name: 'Club A' });
    expect(screen.getByRole('link', { name: 'Nouveau club' })).toHaveAttribute(
      'href',
      '/clubs/new',
    );
  });
});
