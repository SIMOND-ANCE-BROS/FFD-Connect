import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { refreshSession } from './refresh';
import { useSession } from './sessionStore';

const user = {
  id: 'a1',
  email: 'a@x.fr',
  firstName: 'G',
  lastName: 'S',
  role: 'ADMIN',
};

describe('refreshSession', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSession.getState().setSession({ accessToken: 'old', refreshToken: 'rt', user });
  });

  it('is single-flight and stores the rotated tokens', async () => {
    const spy = vi.spyOn(sdk, 'authControllerRefresh').mockResolvedValue({
      data: { access_token: 'new', refresh_token: 'rt2' },
      error: undefined,
    } as never);

    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ body: { refresh_token: 'rt' } });
    expect(a).toBe('new');
    expect(b).toBe('new');
    expect(useSession.getState().refreshToken).toBe('rt2');
  });

  it('clears the session when refresh fails (no loop)', async () => {
    vi.spyOn(sdk, 'authControllerRefresh').mockResolvedValue({
      data: undefined,
      error: { message: 'expired' },
    } as never);

    await expect(refreshSession()).resolves.toBeNull();
    expect(useSession.getState().user).toBeNull();
  });

  it('keeps the session when the server cannot be reached', async () => {
    vi.spyOn(sdk, 'authControllerRefresh').mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(refreshSession()).resolves.toBeNull();
    expect(useSession.getState().refreshToken).toBe('rt');
  });
});
