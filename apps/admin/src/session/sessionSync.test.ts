import { vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import * as sdk from '../api/generated/sdk.gen';
import { type SessionSnapshot, useSession } from './sessionStore';
import {
  PEER_WAIT_MS,
  requestPeerSession,
  resyncAfterRestore,
  signOut,
  startSessionSync,
  stopSessionSync,
  syncBeforeFirstRefresh,
} from './sessionSync';

const admin: SessionSnapshot = {
  accessToken: 'at',
  refreshToken: 'rt',
  user: { id: 'a1', email: 'a@x.fr', firstName: 'G', lastName: 'S', role: 'ADMIN' },
};

/** Another back-office tab of the same origin, seen from this one. */
function openPeerTab(answerWith?: SessionSnapshot) {
  const channel = new BroadcastChannel('ffd-admin-session');
  const received: unknown[] = [];
  channel.onmessage = (event: MessageEvent<unknown>) => {
    received.push(event.data);
    const data = event.data as { type?: string; id?: string };
    if (answerWith && data.type === 'request') {
      channel.postMessage({ type: 'reply', id: data.id, session: answerWith });
    }
  };
  return { channel, received };
}

describe('sessionSync (#669)', () => {
  const peers: BroadcastChannel[] = [];
  const peerTab = (answerWith?: SessionSnapshot) => {
    const peer = openPeerTab(answerWith);
    peers.push(peer.channel);
    return peer;
  };

  let logoutCall: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useSession.getState().clear();
    logoutCall = vi.spyOn(sdk, 'authControllerLogout').mockResolvedValue({
      data: { success: true, message: 'ok' },
      error: undefined,
    } as never);
  });

  afterEach(() => {
    stopSessionSync();
    peers.splice(0).forEach((p) => p.close());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('a new tab copies the session of an open back-office tab into its sessionStorage', async () => {
    peerTab(admin);

    const started = startSessionSync();
    // Waiting for the answer: neither protected content nor the login page.
    expect(useSession.getState().restoring).toBe(true);
    await started;

    const state = useSession.getState();
    expect(state.restoring).toBe(false);
    expect(state.accessToken).toBe('at');
    expect(state.user?.id).toBe('a1');
    expect(sessionStorage.getItem('ffd-admin-session')).toContain('"rt"');
    expect(localStorage.length).toBe(0);
  });

  it('with no back-office tab open, gives up after the wait and stays logged out', async () => {
    const started = Date.now();
    await startSessionSync(50);

    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
    expect(useSession.getState()).toMatchObject({ user: null, restoring: false });
    expect(localStorage.length).toBe(0);
  });

  it('waits at most PEER_WAIT_MS by default', () => {
    expect(PEER_WAIT_MS).toBeLessThanOrEqual(300);
  });

  it('ignores an answer carrying a non-admin session', async () => {
    peerTab({ ...admin, user: { ...admin.user, role: 'LICENSEE' } });
    await startSessionSync(80);
    expect(useSession.getState().user).toBeNull();
  });

  it('does not ask the other tabs when it already has a session', async () => {
    useSession.getState().setSession(admin);
    const peer = peerTab();

    await startSessionSync();

    expect(useSession.getState().restoring).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(peer.received).toEqual([]);
  });

  it('answers the requests of other tabs only while logged in', async () => {
    await startSessionSync(10);
    const peer = peerTab();

    peer.channel.postMessage({ type: 'request', id: 'r1' });
    await new Promise((r) => setTimeout(r, 30));
    expect(peer.received).toEqual([]);

    useSession.getState().setSession(admin);
    peer.received.length = 0;
    peer.channel.postMessage({ type: 'request', id: 'r2' });
    await waitFor(() =>
      expect(peer.received).toContainEqual({
        type: 'reply',
        id: 'r2',
        session: { ...admin, issuedAt: expect.any(Number) },
      }),
    );
  });

  it('signOut logs out the other tabs', async () => {
    useSession.getState().setSession(admin);
    await startSessionSync();
    const peer = peerTab();

    signOut();

    expect(useSession.getState().user).toBeNull();
    await waitFor(() => expect(peer.received).toContainEqual({ type: 'logout', userId: 'a1' }));
  });

  it('a logout from another tab clears this one', async () => {
    useSession.getState().setSession(admin);
    await startSessionSync();
    const peer = peerTab();

    peer.channel.postMessage({ type: 'logout', userId: 'a1' });

    await waitFor(() => expect(useSession.getState().user).toBeNull());
    expect(sessionStorage.getItem('ffd-admin-session')).not.toContain('"rt"');
    // Not echoed back.
    await new Promise((r) => setTimeout(r, 30));
    expect(peer.received).toEqual([]);
  });

  it('signOut revokes the refresh token on the server, once (#680)', async () => {
    useSession.getState().setSession(admin);
    await startSessionSync();

    signOut();

    expect(logoutCall).toHaveBeenCalledTimes(1);
    expect(logoutCall).toHaveBeenCalledWith({ body: { refresh_token: 'rt' } });
    expect(useSession.getState().user).toBeNull();
  });

  it('signOut still logs out locally when the server cannot be reached (#680)', async () => {
    logoutCall.mockRejectedValue(new TypeError('Failed to fetch'));
    useSession.getState().setSession(admin);
    await startSessionSync();
    const peer = peerTab();

    expect(() => signOut()).not.toThrow();

    expect(useSession.getState().user).toBeNull();
    await waitFor(() => expect(peer.received).toContainEqual({ type: 'logout', userId: 'a1' }));
  });

  it('a tab logged out by another tab does not call the server itself', async () => {
    useSession.getState().setSession(admin);
    await startSessionSync();
    const peer = peerTab();

    peer.channel.postMessage({ type: 'logout', userId: 'a1' });

    await waitFor(() => expect(useSession.getState().user).toBeNull());
    expect(logoutCall).not.toHaveBeenCalled();
  });

  it('a logout of another account leaves this tab logged in', async () => {
    useSession.getState().setSession(admin);
    await startSessionSync();
    const peer = peerTab();

    peer.channel.postMessage({ type: 'logout', userId: 'b2' });
    await new Promise((r) => setTimeout(r, 30));

    expect(useSession.getState().refreshToken).toBe('rt');
  });

  it('a logout seen while restoring voids the reply that follows', async () => {
    const channel = new BroadcastChannel('ffd-admin-session');
    peers.push(channel);
    channel.onmessage = (event: MessageEvent<{ type?: string; id?: string }>) => {
      if (event.data.type === 'request') {
        channel.postMessage({ type: 'logout', userId: 'a1' });
        channel.postMessage({ type: 'reply', id: event.data.id, session: admin });
      }
    };

    await startSessionSync();

    expect(useSession.getState()).toMatchObject({ user: null, restoring: false });
  });

  it('back/forward cache: takes a rotation made by another tab while frozen', async () => {
    useSession.getState().setSession(admin);
    await startSessionSync();
    peerTab({ ...admin, accessToken: 'at2', refreshToken: 'rt2' });

    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);

    await waitFor(() => expect(useSession.getState().refreshToken).toBe('rt2'));
  });

  it('back/forward cache: ignores a peer of another account', async () => {
    useSession.getState().setSession(admin);
    await startSessionSync();
    peerTab({ ...admin, refreshToken: 'other', user: { ...admin.user, id: 'b2' } });

    await resyncAfterRestore(50);

    expect(useSession.getState().refreshToken).toBe('rt');
  });

  it('back/forward cache: a session gone from storage sends to the login page', async () => {
    useSession.getState().setSession(admin);
    await startSessionSync();
    sessionStorage.removeItem('ffd-admin-session');

    await resyncAfterRestore(10);

    expect(useSession.getState().user).toBeNull();
  });

  it('pushes a token rotation to the other tabs', async () => {
    useSession.getState().setSession(admin);
    await startSessionSync();
    const peer = peerTab();

    useSession.getState().setSession({ ...admin, accessToken: 'at2', refreshToken: 'rt2' });

    await waitFor(() =>
      expect(peer.received).toContainEqual({
        type: 'update',
        session: {
          ...admin,
          accessToken: 'at2',
          refreshToken: 'rt2',
          issuedAt: expect.any(Number),
        },
      }),
    );
  });

  it('takes a rotation from another tab for the same account, without echoing it', async () => {
    useSession.getState().setSession(admin);
    await startSessionSync();
    const peer = peerTab();

    peer.channel.postMessage({
      type: 'update',
      session: { ...admin, accessToken: 'at2', refreshToken: 'rt2' },
    });

    await waitFor(() => expect(useSession.getState().refreshToken).toBe('rt2'));
    await new Promise((r) => setTimeout(r, 30));
    expect(peer.received).toEqual([]);
  });

  it('ignores a rotation for another account or while logged out', async () => {
    await startSessionSync(10);
    const peer = peerTab();

    peer.channel.postMessage({ type: 'update', session: admin });
    await new Promise((r) => setTimeout(r, 30));
    expect(useSession.getState().user).toBeNull();

    useSession.getState().setSession(admin);
    peer.channel.postMessage({
      type: 'update',
      session: { ...admin, refreshToken: 'other', user: { ...admin.user, id: 'b2' } },
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(useSession.getState().refreshToken).toBe('rt');
  });

  it.each([
    ['not an object', 'logout'],
    ['a logout without account', { type: 'logout' }],
    ['an unknown type', { type: 'steal' }],
    ['a reply without session', { type: 'reply', id: 'x' }],
    ['an update with a bad user', { type: 'update', session: { ...admin, user: { id: 1 } } }],
    ['a request without id', { type: 'request' }],
  ])('ignores a malformed message (%s)', async (_label, message) => {
    useSession.getState().setSession(admin);
    await startSessionSync();
    const peer = peerTab();

    peer.channel.postMessage(message);
    await new Promise((r) => setTimeout(r, 30));

    expect(useSession.getState().refreshToken).toBe('rt');
    expect(peer.received).toEqual([]);
  });

  it('keeps the session in memory when the storage is blocked (#577)', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    peerTab(admin);

    await expect(startSessionSync()).resolves.toBeUndefined();
    expect(useSession.getState().accessToken).toBe('at');
  });

  it('does nothing without BroadcastChannel (old browser)', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);

    await startSessionSync();

    expect(useSession.getState()).toMatchObject({ user: null, restoring: false });
    await expect(requestPeerSession()).resolves.toBeNull();
    // signOut still logs this tab out.
    useSession.getState().setSession(admin);
    signOut();
    expect(useSession.getState().user).toBeNull();
  });
  describe('first refresh after a startup from a stored session (#687)', () => {
    const stale = { ...admin, issuedAt: 1_000 };
    const fresh = { ...admin, accessToken: 'at2', refreshToken: 'rt2', issuedAt: 2_000 };

    it('takes the newer session of an open tab, once', async () => {
      useSession.getState().setSession(stale);
      await startSessionSync();
      peerTab(fresh);

      await expect(syncBeforeFirstRefresh(50)).resolves.toBe('at2');
      expect(useSession.getState()).toMatchObject({ refreshToken: 'rt2', issuedAt: 2_000 });
      // Only the first refresh asks.
      await expect(syncBeforeFirstRefresh(50)).resolves.toBeNull();
    });

    it('keeps its own token when the open tab holds an older one', async () => {
      useSession.getState().setSession(fresh);
      await startSessionSync();
      peerTab(stale);

      await expect(syncBeforeFirstRefresh(50)).resolves.toBeNull();
      expect(useSession.getState().refreshToken).toBe('rt2');
    });

    it('takes a different token when the sessions predate the stamp', async () => {
      useSession.setState({
        accessToken: 'at',
        refreshToken: 'rt',
        user: admin.user,
        issuedAt: null,
      });
      await startSessionSync();
      peerTab({ ...admin, accessToken: 'at2', refreshToken: 'rt2' });

      await expect(syncBeforeFirstRefresh(50)).resolves.toBe('at2');
    });

    it('ignores another account and goes on when no tab answers', async () => {
      useSession.getState().setSession(stale);
      await startSessionSync();
      peerTab({ ...fresh, user: { ...admin.user, id: 'b2' } });

      await expect(syncBeforeFirstRefresh(50)).resolves.toBeNull();
      expect(useSession.getState().refreshToken).toBe('rt');
    });

    it('does not ask when the tab started without a session', async () => {
      await startSessionSync(10);
      useSession.getState().setSession(stale);
      const peer = peerTab(fresh);

      await expect(syncBeforeFirstRefresh(50)).resolves.toBeNull();
      expect(peer.received).toEqual([]);
    });

    it('does not ask once a rotation from another tab was taken', async () => {
      useSession.getState().setSession(stale);
      await startSessionSync();
      const peer = peerTab();
      peer.channel.postMessage({ type: 'update', session: fresh });
      await waitFor(() => expect(useSession.getState().refreshToken).toBe('rt2'));

      await expect(syncBeforeFirstRefresh(50)).resolves.toBeNull();
      expect(peer.received).toEqual([]);
    });

    it('rejects a message with a malformed stamp', async () => {
      useSession.getState().setSession(stale);
      await startSessionSync();
      const peer = peerTab();
      peer.channel.postMessage({ type: 'update', session: { ...fresh, issuedAt: 'soon' } });
      await new Promise((r) => setTimeout(r, 30));

      expect(useSession.getState().refreshToken).toBe('rt');
    });
  });
});
