import { vi } from 'vitest';
import { useSession } from './sessionStore';

const user = {
  id: 'a1',
  email: 'a@x.fr',
  firstName: 'G',
  lastName: 'S',
  role: 'ADMIN',
};

describe('sessionStore', () => {
  beforeEach(() => useSession.getState().clear());

  it('stores the session in sessionStorage, never localStorage', () => {
    useSession.getState().setSession({ accessToken: 'at', refreshToken: 'rt', user });
    expect(useSession.getState().accessToken).toBe('at');
    expect(sessionStorage.getItem('ffd-admin-session')).toContain('"rt"');
    expect(localStorage.getItem('ffd-admin-session')).toBeNull();
  });

  it('keeps the session in memory when the storage is blocked (#577)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    try {
      expect(() =>
        useSession.getState().setSession({ accessToken: 'at', refreshToken: 'rt', user }),
      ).not.toThrow();
      expect(useSession.getState().accessToken).toBe('at');
    } finally {
      spy.mockRestore();
    }
  });

  it('clear() wipes memory and storage', () => {
    useSession.getState().setSession({ accessToken: 'at', refreshToken: 'rt', user });
    useSession.getState().clear();
    expect(useSession.getState().user).toBeNull();
    expect(sessionStorage.getItem('ffd-admin-session')).not.toContain('"rt"');
  });
});
