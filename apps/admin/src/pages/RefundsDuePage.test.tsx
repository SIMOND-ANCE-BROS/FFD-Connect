import { screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { sortButton } from '../test/dataTable';
import { renderWithProviders, setupUser } from '../test/render';
import { mockPhoneViewport } from '../test/viewport';
import { RefundsDuePage } from './RefundsDuePage';

const rows = [
  {
    bookingId: 'b1',
    club: { id: 'c1', name: 'Club de Lyon' },
    competition: { id: 'k1', title: 'Open de Lyon', date: '2026-11-01T00:00:00.000Z' },
    dancer: { firstName: 'Jeanne', lastName: 'Martin' },
    seatNumber: 3,
    amountCents: 1500,
    helloAssoCheckoutIntentIds: ['901', '902'],
    refundOwedAt: '2026-10-11T10:00:00.000Z',
  },
  {
    bookingId: 'b2',
    club: { id: null, name: 'Association Nice' },
    competition: { id: 'k2', title: 'Bal de Nice', date: '2026-11-08T00:00:00.000Z' },
    dancer: { firstName: 'Paul', lastName: 'Durand' },
    seatNumber: null,
    amountCents: null,
    helloAssoCheckoutIntentIds: ['903'],
    refundOwedAt: '2026-10-12T10:00:00.000Z',
  },
];

function mockList(data: object[] = rows, total = data.length) {
  return vi.spyOn(sdk, 'adminRefundsDueControllerList').mockResolvedValue({
    data: { data, meta: { total, skip: 0, take: 50, hasMore: total > 50 } },
    error: undefined,
  } as never);
}

function Probe() {
  const { search } = useLocation();
  return <p data-testid="search">{search}</p>;
}

function renderPage(route = '/refunds-due') {
  return renderWithProviders(
    <>
      <RefundsDuePage />
      <Probe />
    </>,
    { route },
  );
}

describe('RefundsDuePage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('lists the refunds owed by every club, oldest first, with what HelloAsso needs', async () => {
    const list = mockList();
    renderPage();
    expect(await screen.findByRole('link', { name: 'Club de Lyon' })).toHaveAttribute(
      'href',
      '/clubs/c1',
    );
    // An unlinked competition names its organiser label, without a link.
    expect(screen.getByText('Association Nice')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Association Nice' })).toBeNull();
    expect(screen.getByText('Open de Lyon')).toBeInTheDocument();
    expect(screen.getByText('901, 902')).toBeInTheDocument();
    expect(screen.getByText(/^30,00\s€$/)).toBeInTheDocument();
    expect(screen.getByText(/2 paiements de 15,00\s€/)).toBeInTheDocument();
    expect(screen.getByText('11/10/2026 12:00')).toBeInTheDocument();
    expect(screen.getByText('2 remboursements dus')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ query: { skip: 0, take: 50 } });
  });

  it('sends the URL filters, sort and page to the API', async () => {
    const list = mockList(rows, 120);
    renderPage('/refunds-due?f.club=contains:lyon&sort=amount&order=desc&page=2');
    await screen.findByRole('link', { name: 'Club de Lyon' });
    expect(list).toHaveBeenCalledWith({
      query: {
        filters: JSON.stringify([{ field: 'club', op: 'contains', value: 'lyon' }]),
        sortBy: 'amount',
        sortOrder: 'desc',
        skip: 50,
        take: 50,
      },
    });
    expect(screen.getByRole('button', { name: /Retirer le filtre : Club/ })).toBeInTheDocument();
  });

  it('sorts on a column header, in the URL', async () => {
    mockList();
    const user = setupUser();
    renderPage();
    await screen.findByRole('link', { name: 'Club de Lyon' });
    await user.click(sortButton('Club'));
    await waitFor(() =>
      expect(screen.getByTestId('search')).toHaveTextContent('?sort=club&order=asc'),
    );
  });

  it('says so when nothing is owed', async () => {
    mockList([]);
    renderPage();
    expect(await screen.findByText('Aucun remboursement dû')).toBeInTheDocument();
  });

  it('shows a French message when the server cannot be reached', async () => {
    vi.spyOn(sdk, 'adminRefundsDueControllerList').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
    } as never);
    renderPage();
    expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument();
  });

  it('shows cards on a phone, a linked club opening its record', async () => {
    mockPhoneViewport();
    mockList();
    renderPage();
    expect(await screen.findByRole('link', { name: /Club de Lyon/ })).toHaveAttribute(
      'href',
      '/clubs/c1',
    );
    expect(screen.getByText('Club non relié')).toBeInTheDocument();
  });
});
