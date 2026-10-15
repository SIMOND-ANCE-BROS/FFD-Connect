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
 * logout in one tab logs the others out.
 */
const CHANNEL_NAME = 'ffd-admin-session';

/** How long a fresh tab waits for another tab before showing the login page. */
export const PEER_WAIT_MS = 300;

type SyncMessage =
  | { type: 'request'; id: string }
  | { type: 'reply'; id: string; session: SessionSnapshot }
  | { type: 'update'; session: SessionSnapshot }
  | { type: 'logout' };

let channel: BroadcastChannel | null = null;
let unsubscribe: (() => void) | null = null;
/** Set while a change received from another tab is applied: not echoed back. */
let applyingRemote = false;
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
      return { type: 'logout' };
    default:
      return null;
  }
}

/** The admin session held by this tab, if any. */
function currentSnapshot(): SessionSnapshot | null {
  const { accessToken, refreshToken, user } = useSession.getState();
  if (!accessToken || !refreshToken || !user || !isAdmin(user)) return null;
  return { accessToken, refreshToken, user };
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
      }
      return;
    }
    case 'logout':
      if (useSession.getState().user) applyRemote(() => useSession.getState().clear());
      return;
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

/** Logs this tab out and tells the other back-office tabs to do the same. */
export function signOut(): void {
  useSession.getState().clear();
  post({ type: 'logout' });
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

  if (currentSnapshot()) return Promise.resolve();
  useSession.setState({ restoring: true });
  return requestPeerSession(waitMs).then((session) => {
    // A login in this tab meanwhile wins over the peer's session.
    if (session && !currentSnapshot()) adoptPeerSession(session);
    useSession.setState({ restoring: false });
  });
}

/** Leaves the channel (tests). */
export function stopSessionSync(): void {
  unsubscribe?.();
  unsubscribe = null;
  channel?.close();
  channel = null;
  pendingRequests.clear();
  useSession.setState({ restoring: false });
}
