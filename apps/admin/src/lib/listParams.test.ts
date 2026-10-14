import { auditFilter, readAuditParams, writeAuditParams } from './auditList';
import { clubsFilter, readClubsParams, writeClubsParams } from './clubList';
import { readUsersParams, USERS_FILTERS_CLEARED, usersFilter, writeUsersParams } from './userList';

const enc = (url: string) => new URLSearchParams(url).toString();

describe('users list URL state', () => {
  it('defaults to every account, first page, default order', () => {
    expect(readUsersParams(new URLSearchParams())).toEqual({
      q: '',
      filters: [],
      page: 1,
      sort: null,
    });
  });

  it('drops invalid values instead of sending them to the API', () => {
    const state = readUsersParams(
      new URLSearchParams(
        'f.role=in:ROOT&f.password=isEmpty&f.createdAt=lt:01/09/2026&f.createdAt2=eq:2026-09-01&f.email=regex:.*&page=0&sort=password',
      ),
    );
    expect(state).toEqual({ q: '', filters: [], page: 1, sort: null });
  });

  it('round-trips the operator filters, the sort and the page', () => {
    const url = enc(
      'q=mar&f.role=in:CLUB,ADMIN&f.club=isEmpty&f.email=contains:a:b@x.fr&f.createdAt=between:2026-09-01,2026-09-30&sort=lastLoginAt&order=desc&page=2',
    );
    const state = readUsersParams(new URLSearchParams(url));
    expect(state.filters).toEqual([
      { field: 'role', op: 'in', value: ['CLUB', 'ADMIN'] },
      { field: 'club', op: 'isEmpty' },
      // Only the first colon separates the operator: the text keeps the others.
      { field: 'email', op: 'contains', value: 'a:b@x.fr' },
      { field: 'createdAt', op: 'between', value: ['2026-09-01', '2026-09-30'] },
    ]);
    expect(writeUsersParams(new URLSearchParams(url), { page: 2 }).toString()).toBe(url);
    expect(usersFilter(state, 50)).toEqual({
      search: 'mar',
      filters: JSON.stringify([
        { field: 'role', op: 'in', value: ['CLUB', 'ADMIN'] },
        { field: 'club', op: 'isEmpty' },
        { field: 'email', op: 'contains', value: 'a:b@x.fr' },
        { field: 'createdAt', op: 'between', value: ['2026-09-01', '2026-09-30'] },
      ]),
      sortBy: 'lastLoginAt',
      sortOrder: 'desc',
      skip: 50,
      take: 50,
    });
  });

  it('goes back to the first page on any change, and the reset keeps search and sort', () => {
    const params = new URLSearchParams('q=mar&f.role=in:CLUB&sort=name&order=asc&page=4');
    expect(writeUsersParams(params, USERS_FILTERS_CLEARED).toString()).toBe(
      'q=mar&sort=name&order=asc',
    );
  });
});

describe('clubs list URL state', () => {
  it('round-trips the search, the filters, the sort and the page', () => {
    const url = enc('q=paris&f.status=in:disabled&sort=createdAt&order=desc&page=3');
    const state = readClubsParams(new URLSearchParams(url));
    expect(state).toEqual({
      q: 'paris',
      filters: [{ field: 'status', op: 'in', value: ['disabled'] }],
      page: 3,
      sort: { by: 'createdAt', order: 'desc' },
    });
    expect(writeClubsParams(new URLSearchParams(url), { page: 3 }).toString()).toBe(url);
    expect(clubsFilter(state, 50)).toEqual({
      search: 'paris',
      filters: JSON.stringify([{ field: 'status', op: 'in', value: ['disabled'] }]),
      sortBy: 'createdAt',
      sortOrder: 'desc',
      skip: 100,
      take: 50,
    });
  });

  it('defaults to every club, first page, by name', () => {
    expect(
      clubsFilter(readClubsParams(new URLSearchParams('f.status=in:x&sort=email')), 50),
    ).toEqual({ skip: 0, take: 50 });
  });
});

describe('audit log URL state', () => {
  it('round-trips the action, the target type, the date sort and the page', () => {
    const url = enc(
      'f.action=in:USER_DELETE&f.targetType=notIn:USER&sort=createdAt&order=asc&page=2',
    );
    const state = readAuditParams(new URLSearchParams(url));
    expect(writeAuditParams(new URLSearchParams(url), { page: 2 }).toString()).toBe(url);
    expect(auditFilter(state, 50)).toEqual({
      filters: JSON.stringify([
        { field: 'action', op: 'in', value: ['USER_DELETE'] },
        { field: 'targetType', op: 'notIn', value: ['USER'] },
      ]),
      sortBy: 'createdAt',
      sortOrder: 'asc',
      skip: 50,
      take: 50,
    });
  });

  it('ignores an unknown action, target or sort field', () => {
    expect(
      readAuditParams(new URLSearchParams('f.action=in:DROP&f.targetType=in:X&sort=action')),
    ).toEqual({ filters: [], page: 1, sort: null });
  });

  it('a filter change goes back to the first page', () => {
    expect(
      writeAuditParams(new URLSearchParams('page=5'), {
        filters: [{ field: 'targetType', op: 'in', value: ['CLUB'] }],
      }).toString(),
    ).toBe(enc('f.targetType=in:CLUB'));
  });
});
