import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { refreshSession } from './refresh';
import { useSession } from './sessionStore';
import { startSessionSync, stopSessionSync } from './sessionSync';

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

  it('takes the tokens another tab rotated just before (#669)', async () => {
    const spy = vi.spyOn(sdk, 'authControllerRefresh').mockImplementation(async () => {
      // The other tab's rotation reaches this one while the request is in flight.
      useSession.getState().setSession({ accessToken: 'peer-at', refreshToken: 'peer-rt', user });
      return {
        data: undefined,
        error: { message: 'revoked' },
        response: new Response(null, { status: 401 }),
      } as never;
    });

    await expect(refreshSession()).resolves.toBe('peer-at');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(useSession.getState().refreshToken).toBe('peer-rt');
  });

  it('asks the open tabs for a newer session before giving up (#669)', async () => {
    await startSessionSync();
    const peer = new BroadcastChannel('ffd-admin-session');
    peer.onmessage = (event: MessageEvent<{ type: string; id: string }>) => {
      if (event.data.type === 'request') {
        peer.postMessage({
          type: 'reply',
          id: event.data.id,
          session: { accessToken: 'peer-at', refreshToken: 'peer-rt', user },
        });
      }
    };
    vi.spyOn(sdk, 'authControllerRefresh').mockResolvedValue({
      data: undefined,
      error: { message: 'revoked' },
      response: new Response(null, { status: 401 }),
    } as never);

    try {
      await expect(refreshSession()).resolves.toBe('peer-at');
      expect(useSession.getState().refreshToken).toBe('peer-rt');
    } finally {
      peer.close();
      stopSessionSync();
    }
  });

  it('clears the session when the open tabs hold the same rejected token (#669)', async () => {
    await startSessionSync();
    const peer = new BroadcastChannel('ffd-admin-session');
    peer.onmessage = (event: MessageEvent<{ type: string; id: string }>) => {
      if (event.data.type === 'request') {
        peer.postMessage({
          type: 'reply',
          id: event.data.id,
          session: { accessToken: 'old', refreshToken: 'rt', user },
        });
      }
    };
    vi.spyOn(sdk, 'authControllerRefresh').mockResolvedValue({
      data: undefined,
      error: { message: 'revoked' },
      response: new Response(null, { status: 401 }),
    } as never);

    try {
      await expect(refreshSession()).resolves.toBeNull();
      expect(useSession.getState().user).toBeNull();
    } finally {
      peer.close();
      stopSessionSync();
    }
  });

  it('never adopts the session of another account held by an open tab (#669)', async () => {
    await startSessionSync();
    const peer = new BroadcastChannel('ffd-admin-session');
    peer.onmessage = (event: MessageEvent<{ type: string; id: string }>) => {
      if (event.data.type === 'request') {
        peer.postMessage({
          type: 'reply',
          id: event.data.id,
          session: { accessToken: 'b-at', refreshToken: 'b-rt', user: { ...user, id: 'b2' } },
        });
      }
    };
    vi.spyOn(sdk, 'authControllerRefresh').mockResolvedValue({
      data: undefined,
      error: { message: 'revoked' },
      response: new Response(null, { status: 401 }),
    } as never);

    try {
      await expect(refreshSession()).resolves.toBeNull();
      expect(useSession.getState().user).toBeNull();
      expect(useSession.getState().refreshToken).toBeNull();
    } finally {
      peer.close();
      stopSessionSync();
    }
  });

  it('a logout during the call is not undone by the late answer (#669)', async () => {
    vi.spyOn(sdk, 'authControllerRefresh').mockImplementation(async () => {
      useSession.getState().clear();
      return {
        data: { access_token: 'new', refresh_token: 'rt2' },
        error: undefined,
        response: new Response(null, { status: 200 }),
      } as never;
    });

    await expect(refreshSession()).resolves.toBeNull();
    expect(useSession.getState()).toMatchObject({ user: null, refreshToken: null });
  });

  it('does not ask the open tabs after a 401 when logged out meanwhile (#669)', async () => {
    await startSessionSync();
    const peer = new BroadcastChannel('ffd-admin-session');
    const received: unknown[] = [];
    peer.onmessage = (event: MessageEvent<unknown>) => received.push(event.data);
    vi.spyOn(sdk, 'authControllerRefresh').mockImplementation(async () => {
      useSession.getState().clear();
      return {
        data: undefined,
        error: { message: 'revoked' },
        response: new Response(null, { status: 401 }),
      } as never;
    });

    try {
      await expect(refreshSession()).resolves.toBeNull();
      await new Promise((r) => setTimeout(r, 30));
      // Only the check made before the first refresh of a tab started from a
      // stored session (#687): no request after the 401.
      expect(received).toEqual([{ type: 'request', id: expect.any(String) }]);
      expect(useSession.getState().user).toBeNull();
    } finally {
      peer.close();
      stopSessionSync();
    }
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
  describe('tab discarded by the browser then reloaded (#687)', () => {
    const replyWith = (peer: BroadcastChannel, session: unknown) => {
      peer.onmessage = (event: MessageEvent<{ type: string; id: string }>) => {
        if (event.data.type === 'request') {
          peer.postMessage({ type: 'reply', id: event.data.id, session });
        }
      };
    };

    afterEach(() => {
      Reflect.deleteProperty(document, 'wasDiscarded');
      stopSessionSync();
    });

    it('takes the rotated session of an open tab and never sends its stale token', async () => {
      // Discarded by Memory Saver: sessionStorage kept, rotations missed,
      // reloaded with pageshow.persisted false.
      Object.defineProperty(document, 'wasDiscarded', { value: true, configurable: true });
      useSession
        .getState()
        .setSession({ accessToken: 'old', refreshToken: 'rt', user, issuedAt: 1 });
      await startSessionSync();
      const peer = new BroadcastChannel('ffd-admin-session');
      replyWith(peer, { accessToken: 'peer-at', refreshToken: 'peer-rt', user, issuedAt: 2 });
      const spy = vi.spyOn(sdk, 'authControllerRefresh');

      try {
        await expect(refreshSession()).resolves.toBe('peer-at');
        expect(spy).not.toHaveBeenCalled();
        expect(useSession.getState().refreshToken).toBe('peer-rt');
      } finally {
        peer.close();
      }
    });

    it('refreshes normally when no other tab is open', async () => {
      Object.defineProperty(document, 'wasDiscarded', { value: true, configurable: true });
      await startSessionSync();
      const spy = vi.spyOn(sdk, 'authControllerRefresh').mockResolvedValue({
        data: { access_token: 'new', refresh_token: 'rt2' },
        error: undefined,
        response: new Response(null, { status: 200 }),
      } as never);

      await expect(refreshSession()).resolves.toBe('new');
      expect(spy).toHaveBeenCalledWith({ body: { refresh_token: 'rt' } });
    });

    it('refreshes with its own token when the open tab holds the same one', async () => {
      await startSessionSync();
      const peer = new BroadcastChannel('ffd-admin-session');
      replyWith(peer, { accessToken: 'old', refreshToken: 'rt', user });
      const spy = vi.spyOn(sdk, 'authControllerRefresh').mockResolvedValue({
        data: { access_token: 'new', refresh_token: 'rt2' },
        error: undefined,
        response: new Response(null, { status: 200 }),
      } as never);

      try {
        await expect(refreshSession()).resolves.toBe('new');
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith({ body: { refresh_token: 'rt' } });
      } finally {
        peer.close();
      }
    });
  });
});
