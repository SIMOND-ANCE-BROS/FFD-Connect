import { authControllerRefresh } from '../api/generated/sdk.gen';
import { useSession } from './sessionStore';
import { adoptPeerSession, requestPeerSession } from './sessionSync';

let inFlight: Promise<string | null> | null = null;

/**
 * New access token if another tab rotated `rejected` meanwhile: already
 * pushed to this tab, or held by an open tab.
 */
async function rotatedByAnotherTab(rejected: string): Promise<string | null> {
  const current = useSession.getState();
  if (current.accessToken && current.refreshToken && current.refreshToken !== rejected) {
    return current.accessToken;
  }
  const peer = await requestPeerSession();
  if (!peer || peer.refreshToken === rejected) return null;
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

  const { data, response } = result;
  const status = response?.status;
  if (status === 401 || status === 403) {
    // Another back-office tab may have rotated the shared refresh token just
    // before us (#669): take its tokens rather than ending the session.
    const rotated = await rotatedByAnotherTab(refreshToken);
    if (rotated) return rotated;
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
