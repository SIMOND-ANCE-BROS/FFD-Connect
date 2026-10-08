import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { isAdmin, useSession } from './sessionStore';

/** UX guard only — the API enforces ADMIN on every /admin route. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const user = useSession((s) => s.user);
  if (!isAdmin(user)) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
