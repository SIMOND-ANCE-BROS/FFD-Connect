import { authControllerLogout } from '../api/generated/sdk.gen';
import { isAdmin, type SessionSnapshot, type SessionUser, useSession } from './sessionStore';

/**
 * Shares the admin session between the back-office tabs of this browser (#669).
 *
 * The session lives in sessionStorage, so a tab opened with a middle click
 * starts empty. On startup such a tab asks the open back-office tabs for their
 * session and copies it into its own sessionStorage; with no tab open it gets
 * no answer and goes to the login page, as before. Never localStorage: once
 * every back-office tab is closed, nothing keeps the session.
 *
 * Security: BroadcastChannel only reaches same-origin contexts of the same
 * browser profile and storage partition — another site can neither post on
 * this channel nor listen to it, and same-origin script could read
 * sessionStorage anyway.
 *
 * The tabs also keep each other in step: a token rotation (refresh) is pushed
 * to the others, since the backend revokes the previous refresh token, and a
 * logout in one tab revokes the refresh token (#680) and logs out the other
 * tabs of the same account.
 */
const CHANNEL_NAME = 'ffd-admin-session';
/** sessionStorage key of the persisted session (sessionStore.ts). */
const STORAGE_KEY = 'ffd-admin-session';

/** How long a fresh tab waits for another tab before showing the login page. */
export const PEER_WAIT_MS = 300;

type SyncMessage =
  | { type: 'request'; id: string }
  | { type: 'reply'; id: string; session: SessionSnapshot }
  | { type: 'update'; session: SessionSnapshot }
  | { type: 'logout'; userId: string };

let channel: BroadcastChannel | null = null;
let unsubscribe: (() => void) | null = null;
let removePageShow: (() => void) | null = null;
/** Set while a change received from another tab is applied: not echoed back. */
let applyingRemote = false;
/** A logout was announced while this tab was restoring: adopt no reply. */
let logoutSeenWhileRestoring = false;
/**
 * This tab started from a session saved in its own sessionStorage (reload,
 * tab discarded by the browser then reloaded, session restore): it may have
 * missed token rotations pushed by the other tabs while it was not running.
 * Its first refresh checks the open tabs first (#687): sending a superseded
 * refresh token now revokes the token family shared by every tab.
 */
let restoredFromStorage = false;
const pendingRequests = new Map<string, (session: SessionSnapshot) => void>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function isSessionUser(value: unknown): value is SessionUser {
  if (!isRecord(value)) return false;
  const { id, email, firstName, lastName, role, roles } = value;
  return (
    typeof id === 'string' &&
    typeof email === 'string' &&
    typeof firstName === 'string' &&
    typeof lastName === 'string' &&
    typeof role === 'string' &&
    (roles === undefined || (Array.isArray(roles) && roles.every((r) => typeof r === 'string')))
  );
}

function isSnapshot(value: unknown): value is SessionSnapshot {
  return (
    isRecord(value) &&
    (value.issuedAt === undefined ||
      (typeof value.issuedAt === 'number' && Number.isFinite(value.issuedAt))) &&
    typeof value.accessToken === 'string' &&
    value.accessToken !== '' &&
    typeof value.refreshToken === 'string' &&
    value.refreshToken !== '' &&
    isSessionUser(value.user)
  );
}

/** Same-origin peers only, but still never trust the shape of a message. */
function parseMessage(data: unknown): SyncMessage | null {
  if (!isRecord(data)) return null;
  switch (data.type) {
    case 'request':
      return typeof data.id === 'string' ? { type: 'request', id: data.id } : null;
    case 'reply':
      return typeof data.id === 'string' && isSnapshot(data.session)
        ? { type: 'reply', id: data.id, session: data.session }
        : null;
    case 'update':
      return isSnapshot(data.session) ? { type: 'update', session: data.session } : null;
    case 'logout':
      return typeof data.userId === 'string' ? { type: 'logout', userId: data.userId } : null;
    default:
      return null;
  }
}

/** The admin session held by this tab, if any. */
function currentSnapshot(): SessionSnapshot | null {
  const { accessToken, refreshToken, user, issuedAt } = useSession.getState();
  if (!accessToken || !refreshToken || !user || !isAdmin(user)) return null;
  return issuedAt === null
    ? { accessToken, refreshToken, user }
    : { accessToken, refreshToken, user, issuedAt };
}

/**
 * Whether a peer's session of the same account holds a newer refresh token
 * than this tab's. Both stamped: the later one wins, so a tab never takes an
 * older token from another stale tab. A session saved before #687 has no
 * stamp: a different token is then taken, as before.
 */
function isNewerSession(peer: SessionSnapshot, mine: SessionSnapshot): boolean {
  if (peer.user.id !== mine.user.id || peer.refreshToken === mine.refreshToken) return false;
  if (peer.issuedAt === undefined || mine.issuedAt === undefined) return true;
  return peer.issuedAt > mine.issuedAt;
}

function post(message: SyncMessage): void {
  try {
    channel?.postMessage(message);
  } catch {
    // A closed channel: this tab simply stops syncing.
  }
}

function applyRemote(change: () => void): void {
  applyingRemote = true;
  try {
    change();
  } finally {
    applyingRemote = false;
  }
}

/** Takes a session received from another tab without sending it back. */
export function adoptPeerSession(session: SessionSnapshot): void {
  applyRemote(() => useSession.getState().setSession(session));
}

function onMessage(event: MessageEvent<unknown>): void {
  const message = parseMessage(event.data);
  if (!message) return;
  switch (message.type) {
    case 'request': {
      const session = currentSnapshot();
      if (session) post({ type: 'reply', id: message.id, session });
      return;
    }
    case 'reply':
      pendingRequests.get(message.id)?.(message.session);
      return;
    case 'update': {
      // Token rotation of the same account only: a tab that is logged out,
      // or on another account, is left alone.
      const { user } = useSession.getState();
      if (user && user.id === message.session.user.id && isAdmin(message.session.user)) {
        adoptPeerSession(message.session);
        // Up to date with the other tabs again.
        restoredFromStorage = false;
      }
      return;
    }
    case 'logout': {
      const state = useSession.getState();
      // Arriving between the request and the reply of a restoring tab: the
      // session it is about to receive is being ended.
      if (state.restoring) logoutSeenWhileRestoring = true;
      // Only the account that logged out: a tab on another account stays.
      if (state.user?.id === message.userId) applyRemote(() => state.clear());
      return;
    }
  }
}

const newRequestId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Asks the other back-office tabs for their admin session; resolves with the
 * first answer, or null after `waitMs` (no tab open) or when sync is off.
 */
export function requestPeerSession(waitMs = PEER_WAIT_MS): Promise<SessionSnapshot | null> {
  if (!channel) return Promise.resolve(null);
  const id = newRequestId();
  return new Promise((resolve) => {
    const done = (session: SessionSnapshot | null) => {
      clearTimeout(timer);
      pendingRequests.delete(id);
      resolve(session);
    };
    const timer = setTimeout(() => done(null), waitMs);
    pendingRequests.set(id, (session) => (isAdmin(session.user) ? done(session) : undefined));
    post({ type: 'request', id });
  });
}

/**
 * Logs out: revokes the refresh token on the server (#680, best effort, not
 * awaited — offline, the local logout still happens), clears this tab and
 * tells the other back-office tabs of the same account to do the same.
 */
export function signOut(): void {
  const { refreshToken, user } = useSession.getState();
  if (refreshToken) {
    try {
      void authControllerLogout({ body: { refresh_token: refreshToken } }).catch(() => undefined);
    } catch {
      // Never block the local logout.
    }
  }
  useSession.getState().clear();
  if (user) post({ type: 'logout', userId: user.id });
}

/** Session state saved in this tab's sessionStorage: false when none, null when unreadable. */
function storedSessionPresent(): boolean | null {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return (
      isRecord(parsed) && isRecord(parsed.state) && typeof parsed.state.refreshToken === 'string'
    );
  } catch {
    return false;
  }
}

/**
 * A page restored from the back/forward cache missed the messages sent while
 * it was frozen: drop a session its storage no longer has, and take a token
 * rotation an open tab of the same account made meanwhile.
 */
export async function resyncAfterRestore(waitMs = PEER_WAIT_MS): Promise<void> {
  if (storedSessionPresent() === false && useSession.getState().user) {
    applyRemote(() => useSession.getState().clear());
    return;
  }
  await adoptNewerPeerSession(waitMs);
}

/**
 * Asks the open tabs for their session and takes it when it is a newer one
 * of the same account. Returns the adopted access token, or null when this
 * tab already holds the latest session (or no tab answered).
 */
async function adoptNewerPeerSession(waitMs: number): Promise<string | null> {
  const mine = currentSnapshot();
  if (!mine) return null;
  const peer = await requestPeerSession(waitMs);
  // A rotation, a logout or a login in this tab meanwhile wins.
  if (!peer || useSession.getState().refreshToken !== mine.refreshToken) return null;
  if (!isNewerSession(peer, mine)) return null;
  adoptPeerSession(peer);
  return peer.accessToken;
}

/**
 * Called by the refresh before it sends anything (#687). The first time after
 * a startup from a stored session, asks the open tabs for the current one: a
 * tab discarded by the browser and reloaded kept its sessionStorage but missed
 * the rotations, and its stale refresh token would now look like a stolen one
 * and revoke the session of every tab. Returns the access token taken from a
 * peer, or null to go on with a normal refresh (no peer, nothing newer, or
 * not the first refresh).
 */
export async function syncBeforeFirstRefresh(waitMs = PEER_WAIT_MS): Promise<string | null> {
  if (!restoredFromStorage) return null;
  restoredFromStorage = false;
  return adoptNewerPeerSession(waitMs);
}

/**
 * Joins the channel. Called once at startup, before the first render: a tab
 * with no session is marked `restoring` (RequireAdmin renders nothing) until
 * another tab answers or PEER_WAIT_MS elapses.
 */
export function startSessionSync(waitMs = PEER_WAIT_MS): Promise<void> {
  if (channel || typeof BroadcastChannel === 'undefined') return Promise.resolve();
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return Promise.resolve();
  }
  channel.onmessage = onMessage;
  unsubscribe = useSession.subscribe((state, previous) => {
    if (applyingRemote) return;
    const rotated =
      state.accessToken !== previous.accessToken || state.refreshToken !== previous.refreshToken;
    const session = currentSnapshot();
    if (rotated && session) post({ type: 'update', session });
  });
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) void resyncAfterRestore();
  };
  window.addEventListener('pageshow', onPageShow);
  removePageShow = () => window.removeEventListener('pageshow', onPageShow);

  if (currentSnapshot()) {
    // Any startup from a stored session: a plain reload, and a tab Chrome's
    // Memory Saver discarded (`document.wasDiscarded`), which reloads with its
    // sessionStorage but with `pageshow.persisted` false, so the bfcache
    // resync below never runs for it.
    restoredFromStorage = true;
    return Promise.resolve();
  }
  logoutSeenWhileRestoring = false;
  useSession.setState({ restoring: true });
  return requestPeerSession(waitMs).then((session) => {
    // A login in this tab meanwhile wins over the peer's session, and a
    // logout seen meanwhile voids it.
    if (session && !currentSnapshot() && !logoutSeenWhileRestoring) adoptPeerSession(session);
    logoutSeenWhileRestoring = false;
    useSession.setState({ restoring: false });
  });
}

/** Leaves the channel (tests). */
export function stopSessionSync(): void {
  unsubscribe?.();
  unsubscribe = null;
  removePageShow?.();
  removePageShow = null;
  logoutSeenWhileRestoring = false;
  restoredFromStorage = false;
  channel?.close();
  channel = null;
  pendingRequests.clear();
  useSession.setState({ restoring: false });
}
