import { createBrowserRouter, Navigate } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { AuditLogPage } from './pages/AuditLogPage';
import { LoginPage } from './pages/LoginPage';
import { NewUserPage } from './pages/NewUserPage';
import { UserDetailPage } from './pages/UserDetailPage';
import { UsersPage } from './pages/UsersPage';
import { RequireAdmin } from './session/RequireAdmin';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAdmin>
        <AppLayout />
      </RequireAdmin>
    ),
    children: [
      { index: true, element: <Navigate to="/users" replace /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'users/new', element: <NewUserPage /> },
      { path: 'users/:id', element: <UserDetailPage /> },
      { path: 'audit-log', element: <AuditLogPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/users" replace /> },
]);
