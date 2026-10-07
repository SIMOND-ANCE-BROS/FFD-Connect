import { authControllerRefresh } from '../api/generated/sdk.gen';
import { useSession } from './sessionStore';

let inFlight: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const { refreshToken, user } = useSession.getState();
  if (!refreshToken || !user) return null;

  let result: Awaited<ReturnType<typeof authControllerRefresh>>;
  try {
    result = await authControllerRefresh({ body: { refresh_token: refreshToken } });
  } catch {
    // Network failure (e.g. backend still waking up): the refresh token may
    // still be valid, so keep the session and let the caller surface the error.
    return null;
  }

  const { data, error } = result;
  if (error || !data?.access_token || !data.refresh_token) {
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
