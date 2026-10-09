import { createBrowserRouter, Navigate } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { AuditLogPage } from './pages/AuditLogPage';
import { LoginPage } from './pages/LoginPage';
import { ModerationPage } from './pages/ModerationPage';
import { NewUserPage } from './pages/NewUserPage';
import { UserDetailPage } from './pages/UserDetailPage';
import { ClubDetailPage } from './pages/ClubDetailPage';
import { ClubsPage } from './pages/ClubsPage';
import { NewClubPage } from './pages/NewClubPage';
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
      { path: 'clubs', element: <ClubsPage /> },
      { path: 'clubs/new', element: <NewClubPage /> },
      { path: 'clubs/:id', element: <ClubDetailPage /> },
      { path: 'moderation', element: <ModerationPage /> },
      { path: 'audit-log', element: <AuditLogPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/users" replace /> },
]);
