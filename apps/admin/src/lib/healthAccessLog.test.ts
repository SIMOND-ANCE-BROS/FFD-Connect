import type { HealthDataAccessLogEntryDto } from '../api/generated/types.gen';
import {
  healthAccessFilter,
  readHealthAccessParams,
  routeLabel,
  subjectJournalPath,
  userIdsOf,
  writeHealthAccessParams,
} from './healthAccessLog';

const A = '4f1c2a8e-1b2c-4d5e-8f90-123456789abc';
const B = '9a8b7c6d-1b2c-4d5e-8f90-abcdefabcdef';

const entry = (over: Partial<HealthDataAccessLogEntryDto>): HealthDataAccessLogEntryDto => ({
  id: 'h1',
  subjectUserId: A,
  actorUserId: B,
  actorRole: 'ADMIN',
  action: 'READ',
  resourceType: 'LICENSE_RENEWAL_REQUEST',
  resourceId: 'r1',
  route: 'GET /admin/license-renewals/:id',
  createdAt: '2026-10-07T10:00:00.000Z',
  ...over,
});

describe('health access journal URL state', () => {
  it('defaults to every access, first page', () => {
    expect(readHealthAccessParams(new URLSearchParams())).toEqual({ page: 1 });
  });

  it('reads the person, the author and the action, dropping invalid values', () => {
    expect(
      readHealthAccessParams(new URLSearchParams(`subject=${A}&actor=${B}&action=EXPORT&page=3`)),
    ).toEqual({ subject: A, actor: B, action: 'EXPORT', page: 3 });
    expect(
      readHealthAccessParams(new URLSearchParams('subject=u1&actor=x&action=PEEK&page=-2')),
    ).toEqual({ page: 1 });
  });

  it('goes back to page 1 on a filter change, keeps the page otherwise', () => {
    const current = new URLSearchParams(`subject=${A}&page=4`);
    expect(writeHealthAccessParams(current, { action: 'READ' }).toString()).toBe(
      `subject=${A}&action=READ`,
    );
    expect(writeHealthAccessParams(current, { page: 2 }).toString()).toBe(`subject=${A}&page=2`);
    expect(writeHealthAccessParams(current, { subject: undefined }).toString()).toBe('');
  });

  it('builds the API filter of a page, ids only', () => {
    expect(healthAccessFilter({ page: 1 }, 25)).toEqual({ skip: 0, take: 25 });
    expect(healthAccessFilter({ subject: A, actor: B, action: 'DELETE', page: 3 }, 25)).toEqual({
      subjectUserId: A,
      actorUserId: B,
      action: 'DELETE',
      skip: 50,
      take: 25,
    });
  });

  it('links a record to its journal', () => {
    expect(subjectJournalPath(A)).toBe(`/health-data-access-log?subject=${A}`);
  });
});

describe('health access journal rows', () => {
  it('names the known entry points, shows an unknown one as is', () => {
    expect(routeLabel('GET /users/me/export')).toBe('App : export de ses données');
    expect(routeLabel('job:health-data-retention')).toMatch(/Purge/);
    expect(routeLabel('GET /somewhere')).toBe('GET /somewhere');
  });

  it('collects the ids to name once each, without the system actor', () => {
    expect(
      userIdsOf(
        [entry({}), entry({ id: 'h2', actorUserId: null, actorRole: 'SYSTEM' })],
        [A, undefined],
      ),
    ).toEqual([A, B]);
  });
});
