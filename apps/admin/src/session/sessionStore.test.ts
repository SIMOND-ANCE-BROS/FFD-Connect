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

  it('clear() wipes memory and storage', () => {
    useSession.getState().setSession({ accessToken: 'at', refreshToken: 'rt', user });
    useSession.getState().clear();
    expect(useSession.getState().user).toBeNull();
    expect(sessionStorage.getItem('ffd-admin-session')).not.toContain('"rt"');
  });
});
