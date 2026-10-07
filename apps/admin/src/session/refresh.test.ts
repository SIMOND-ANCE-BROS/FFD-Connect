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
      response: new Response(null, { status: 200 }),
    } as never);

    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ body: { refresh_token: 'rt' } });
    expect(a).toBe('new');
    expect(b).toBe('new');
    expect(useSession.getState().refreshToken).toBe('rt2');
  });

  it('clears the session when the refresh token is rejected (401)', async () => {
    vi.spyOn(sdk, 'authControllerRefresh').mockResolvedValue({
      data: undefined,
      error: { message: 'expired' },
      response: new Response(null, { status: 401 }),
    } as never);

    await expect(refreshSession()).resolves.toBeNull();
    expect(useSession.getState().user).toBeNull();
  });

  it('clears the session when a 2xx response carries no tokens', async () => {
    vi.spyOn(sdk, 'authControllerRefresh').mockResolvedValue({
      data: {},
      error: undefined,
      response: new Response(null, { status: 200 }),
    } as never);

    await expect(refreshSession()).resolves.toBeNull();
    expect(useSession.getState().user).toBeNull();
  });

  it('keeps the session when the server cannot be reached', async () => {
    // Real shape: the generated client (throwOnError=false) catches fetch's
    // TypeError and resolves with no response.
    vi.spyOn(sdk, 'authControllerRefresh').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
      response: undefined,
    } as never);

    await expect(refreshSession()).resolves.toBeNull();
    expect(useSession.getState().refreshToken).toBe('rt');
  });

  it.each([503, 504])('keeps the session on a %i (backend waking up)', async (status) => {
    vi.spyOn(sdk, 'authControllerRefresh').mockResolvedValue({
      data: undefined,
      error: { message: 'unavailable' },
      response: new Response(null, { status }),
    } as never);

    await expect(refreshSession()).resolves.toBeNull();
    expect(useSession.getState().refreshToken).toBe('rt');
  });

  it('keeps the session if the call rejects anyway', async () => {
    vi.spyOn(sdk, 'authControllerRefresh').mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(refreshSession()).resolves.toBeNull();
    expect(useSession.getState().refreshToken).toBe('rt');
  });
});
