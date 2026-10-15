import { authControllerRefresh } from '../api/generated/sdk.gen';
import { useSession } from './sessionStore';
import { adoptPeerSession, requestPeerSession } from './sessionSync';

let inFlight: Promise<string | null> | null = null;

/**
 * What the session became while a refresh was in flight (#669): the access
 * token another tab rotated in for the same account, null if this tab was
 * logged out or switched account, or undefined when nothing changed.
 */
function changedMeanwhile(sent: string, userId: string): string | null | undefined {
  const current = useSession.getState();
  if (current.refreshToken === sent) return undefined;
  return current.accessToken && current.user?.id === userId ? current.accessToken : null;
}

/**
 * New access token if an open tab of the same account already rotated the
 * rejected refresh token; null otherwise. Another account's session is never
 * adopted.
 */
async function rotatedByAnotherTab(rejected: string, userId: string): Promise<string | null> {
  const peer = await requestPeerSession();
  if (!peer || peer.refreshToken === rejected || peer.user.id !== userId) return null;
  // A logout or a rotation pushed while we waited wins over the peer's answer.
  if (useSession.getState().refreshToken !== rejected) return null;
  adoptPeerSession(peer);
  return peer.accessToken;
}

async function performRefresh(): Promise<string | null> {
  const { refreshToken, user } = useSession.getState();
  if (!refreshToken || !user) return null;

  let result: Awaited<ReturnType<typeof authControllerRefresh>>;
  try {
    result = await authControllerRefresh({ body: { refresh_token: refreshToken } });
  } catch {
    // Defensive: the generated client (throwOnError=false) does not reject.
    return null;
  }

  // Logged out (here or in another tab) or rotated by another tab during the
  // call: write nothing, a late answer must not bring a session back.
  const meanwhile = changedMeanwhile(refreshToken, user.id);
  if (meanwhile !== undefined) return meanwhile;

  const { data, response } = result;
  const status = response?.status;
  if (status === 401 || status === 403) {
    // Another back-office tab may have rotated the shared refresh token just
    // before us (#669): take its tokens rather than ending the session.
    const rotated = await rotatedByAnotherTab(refreshToken, user.id);
    if (rotated) return rotated;
    const after = changedMeanwhile(refreshToken, user.id);
    if (after !== undefined) return after;
    // The refresh token itself is rejected: the session is over.
    useSession.getState().clear();
    return null;
  }
  if (!response?.ok) {
    // No response (network failure, cold start) or 5xx: the refresh token may
    // still be valid, so keep the session and let the caller surface the error.
    return null;
  }
  if (!data?.access_token || !data.refresh_token) {
    useSession.getState().clear();
    return null;
  }
  useSession.getState().setSession({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    user,
  });
  return data.access_token;
}

/**
 * Rotates tokens once even if many requests 401 together: the backend revokes
 * the old refresh token on every call, so parallel refreshes would revoke each
 * other.
 */
export function refreshSession(): Promise<string | null> {
  if (!inFlight) {
    inFlight = performRefresh().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
