import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { isAdmin, useSession } from './sessionStore';

/** UX guard only — the API enforces ADMIN on every /admin route. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const user = useSession((s) => s.user);
  const restoring = useSession((s) => s.restoring);
  // A tab opened from another one is fetching its session (≤ 300 ms, #669):
  // neither the protected page nor the login page yet.
  if (restoring) return null;
  if (!isAdmin(user)) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
