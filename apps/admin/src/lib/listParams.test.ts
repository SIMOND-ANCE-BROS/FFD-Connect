import { auditFilter, readAuditParams, writeAuditParams } from './auditList';
import { clubsFilter, readClubsParams, writeClubsParams } from './clubList';
import { readUsersParams, USERS_FILTERS_CLEARED, usersFilter, writeUsersParams } from './userList';

const CLUB = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('users list URL state', () => {
  it('defaults to every account, first page, default order', () => {
    expect(readUsersParams(new URLSearchParams())).toEqual({
      q: '',
      role: null,
      clubId: null,
      category: null,
      status: 'all',
      createdFrom: null,
      createdTo: null,
      page: 1,
      sort: null,
    });
  });

  it('drops invalid values instead of sending them to the API', () => {
    const state = readUsersParams(
      new URLSearchParams(
        `role=ROOT&club=12&status=gone&from=01/09/2026&to=2026-9-1&page=0&sort=password&category=${'x'.repeat(51)}`,
      ),
    );
    expect(state).toMatchObject({
      role: null,
      clubId: null,
      category: null,
      status: 'all',
      createdFrom: null,
      createdTo: null,
      page: 1,
      sort: null,
    });
  });

  it('round-trips every filter, the sort and the page', () => {
    const url = `q=mar&role=CLUB&club=${CLUB}&category=Latin&status=disabled&from=2026-09-01&to=2026-09-30&sort=lastLoginAt&order=desc&page=2`;
    const state = readUsersParams(new URLSearchParams(url));
    expect(writeUsersParams(new URLSearchParams(url), { page: 2 }).toString()).toBe(url);
    expect(usersFilter(state, 50)).toEqual({
      search: 'mar',
      role: 'CLUB',
      clubId: CLUB,
      category: 'Latin',
      status: 'disabled',
      createdFrom: '2026-09-01',
      createdTo: '2026-09-30',
      sortBy: 'lastLoginAt',
      sortOrder: 'desc',
      skip: 50,
      take: 50,
    });
  });

  it('goes back to the first page on any change, and the reset keeps search and sort', () => {
    const params = new URLSearchParams('q=mar&role=CLUB&status=active&sort=name&order=asc&page=4');
    expect(writeUsersParams(params, USERS_FILTERS_CLEARED).toString()).toBe(
      'q=mar&sort=name&order=asc',
    );
  });
});

describe('clubs list URL state', () => {
  it('round-trips the search, the status, the sort and the page', () => {
    const url = 'q=paris&status=disabled&sort=createdAt&order=desc&page=3';
    const state = readClubsParams(new URLSearchParams(url));
    expect(state).toEqual({
      q: 'paris',
      status: 'disabled',
      page: 3,
      sort: { by: 'createdAt', order: 'desc' },
    });
    expect(writeClubsParams(new URLSearchParams(url), { page: 3 }).toString()).toBe(url);
    expect(clubsFilter(state, 50)).toEqual({
      search: 'paris',
      status: 'disabled',
      sortBy: 'createdAt',
      sortOrder: 'desc',
      skip: 100,
      take: 50,
    });
  });

  it('defaults to every club, first page, by name', () => {
    expect(clubsFilter(readClubsParams(new URLSearchParams('status=x&sort=email')), 50)).toEqual({
      skip: 0,
      take: 50,
    });
  });
});

describe('audit log URL state', () => {
  it('round-trips the action, the target type, the date sort and the page', () => {
    const url = 'action=USER_DELETE&target=USER&sort=createdAt&order=asc&page=2';
    const state = readAuditParams(new URLSearchParams(url));
    expect(writeAuditParams(new URLSearchParams(url), { page: 2 }).toString()).toBe(url);
    expect(auditFilter(state, 50)).toEqual({
      action: 'USER_DELETE',
      targetType: 'USER',
      sortBy: 'createdAt',
      sortOrder: 'asc',
      skip: 50,
      take: 50,
    });
  });

  it('ignores an unknown action, target or sort field', () => {
    expect(readAuditParams(new URLSearchParams('action=DROP&target=X&sort=action'))).toEqual({
      action: null,
      targetType: null,
      page: 1,
      sort: null,
    });
  });

  it('a filter change goes back to the first page', () => {
    expect(writeAuditParams(new URLSearchParams('page=5'), { targetType: 'CLUB' }).toString()).toBe(
      'target=CLUB',
    );
  });
});
