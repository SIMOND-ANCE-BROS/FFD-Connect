import {
  clubLabel,
  clubPath,
  formatAmount,
  readRefundsDueParams,
  refundsDueFilter,
  totalCents,
  writeRefundsDueParams,
} from './refundsDue';

describe('refunds due URL state', () => {
  it('defaults to the first page, no filter, the default order', () => {
    expect(readRefundsDueParams(new URLSearchParams())).toEqual({
      filters: [],
      page: 1,
      sort: null,
    });
  });

  it('reads filters, sort and page, ignoring unknown sort fields', () => {
    const state = readRefundsDueParams(
      new URLSearchParams('f.club=contains:lyon&sort=amount&order=desc&page=3'),
    );
    expect(state.filters).toEqual([{ field: 'club', op: 'contains', value: 'lyon' }]);
    expect(state.sort).toEqual({ by: 'amount', order: 'desc' });
    expect(state.page).toBe(3);
    expect(readRefundsDueParams(new URLSearchParams('sort=dancer')).sort).toBeNull();
  });

  it('goes back to page 1 on a change, keeps the page otherwise', () => {
    const current = new URLSearchParams('sort=club&order=asc&page=4');
    expect(writeRefundsDueParams(current, { page: 2 }).toString()).toBe(
      'sort=club&order=asc&page=2',
    );
    expect(writeRefundsDueParams(current, { sort: null }).toString()).toBe('');
  });

  it('builds the API filter of a page', () => {
    expect(refundsDueFilter({ filters: [], page: 1, sort: null }, 50)).toEqual({
      skip: 0,
      take: 50,
    });
    expect(
      refundsDueFilter(
        {
          filters: [{ field: 'dancer', op: 'contains', value: 'martin' }],
          page: 2,
          sort: { by: 'refundOwedAt', order: 'desc' },
        },
        50,
      ),
    ).toEqual({
      filters: JSON.stringify([{ field: 'dancer', op: 'contains', value: 'martin' }]),
      sortBy: 'refundOwedAt',
      sortOrder: 'desc',
      skip: 50,
      take: 50,
    });
  });
});

describe('refunds due rows', () => {
  it('formats euros, and an unknown amount as a dash', () => {
    expect(formatAmount(1550)).toMatch(/^15,50\s€$/);
    expect(formatAmount(null)).toBe('—');
  });

  it('totals one payment per HelloAsso reference', () => {
    expect(totalCents({ amountCents: 1500, helloAssoCheckoutIntentIds: ['1', '2'] })).toBe(3000);
    expect(totalCents({ amountCents: null, helloAssoCheckoutIntentIds: ['1'] })).toBeNull();
  });

  it('links a linked club, names an unlinked one by its label', () => {
    expect(clubPath({ club: { id: 'c1', name: 'Club A' } })).toBe('/clubs/c1');
    expect(clubPath({ club: { id: null, name: 'Association' } })).toBeNull();
    expect(clubLabel({ club: { id: null, name: null } })).toBe('Club inconnu');
  });
});
