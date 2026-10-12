import type { AdminUserListItemDto } from '../api/generated/types.gen';
import { UNAVAILABLE_MESSAGE } from './apiError';
import {
  holdsClubRole,
  LINK_FAILED_MESSAGE,
  leavesAnotherClub,
  linkEach,
  linkSummary,
} from './linkMembers';

const club = { id: 'c1', name: 'Club A' };

const user = (o: Partial<AdminUserListItemDto> = {}) =>
  ({
    id: 'u1',
    firstName: 'Anna',
    lastName: 'Petit',
    email: 'anna@x.fr',
    role: 'LICENSEE',
    extraRoles: [],
    clubId: null,
    clubName: null,
    ...o,
  }) as AdminUserListItemDto;

describe('leavesAnotherClub', () => {
  it('is false without any club', () => {
    expect(leavesAnotherClub(user(), club)).toBe(false);
  });
  it('is true for another club id, false for this one', () => {
    expect(leavesAnotherClub(user({ clubId: 'c2', clubName: 'Club B' }), club)).toBe(true);
    expect(leavesAnotherClub(user({ clubId: 'c1', clubName: 'Club A' }), club)).toBe(false);
  });
  it('compares a legacy club name case-insensitively', () => {
    expect(leavesAnotherClub(user({ clubName: 'club a' }), club)).toBe(false);
    expect(leavesAnotherClub(user({ clubName: 'Club B' }), club)).toBe(true);
  });
});

describe('holdsClubRole', () => {
  it('detects the CLUB role as main or extra role', () => {
    expect(holdsClubRole(user({ role: 'CLUB' }))).toBe(true);
    expect(holdsClubRole(user({ extraRoles: ['CLUB'] }))).toBe(true);
    expect(holdsClubRole(user())).toBe(false);
  });
});

describe('linkEach', () => {
  it('links every user in order and keeps going after a refusal', async () => {
    const calls: string[] = [];
    const outcomes = await linkEach(
      [user({ id: 'a' }), user({ id: 'b' }), user({ id: 'c' })],
      (u) => {
        calls.push(u.id);
        return u.id === 'b'
          ? Promise.reject({ message: 'Déjà membre d’un autre club' })
          : Promise.resolve(u);
      },
    );
    expect(calls).toEqual(['a', 'b', 'c']);
    expect(outcomes.map((o) => [o.user.id, o.ok])).toEqual([
      ['a', true],
      ['b', false],
      ['c', true],
    ]);
    expect(outcomes[1]).toMatchObject({ error: 'Déjà membre d’un autre club' });
  });

  it('runs the links one after another', async () => {
    let running = 0;
    let peak = 0;
    await linkEach([user({ id: 'a' }), user({ id: 'b' })], async () => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
    });
    expect(peak).toBe(1);
  });

  it('falls back to a generic or network message', async () => {
    const [unknown] = await linkEach([user()], () => Promise.reject(new Error()));
    expect(unknown).toMatchObject({ ok: false, error: LINK_FAILED_MESSAGE });
    const [offline] = await linkEach([user()], () => Promise.reject(new TypeError('fetch')));
    expect(offline).toMatchObject({ ok: false, error: UNAVAILABLE_MESSAGE });
  });
});

describe('linkSummary', () => {
  const ok = { user: user(), ok: true } as const;
  const ko = { user: user(), ok: false, error: 'x' } as const;
  it('pluralises the added and refused counts', () => {
    expect(linkSummary([ok])).toBe('1 membre ajouté');
    expect(linkSummary([ok, ok])).toBe('2 membres ajoutés');
    expect(linkSummary([ok, ko])).toBe('1 membre ajouté, 1 refusé');
    expect(linkSummary([ko, ko])).toBe('0 membre ajouté, 2 refusés');
  });
});
