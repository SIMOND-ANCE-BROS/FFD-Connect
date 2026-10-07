import { createBrowserRouter, Navigate } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { NewClubAccountPage } from './pages/NewClubAccountPage';
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
      { path: 'users/:id', element: <UserDetailPage /> },
      { path: 'club-accounts/new', element: <NewClubAccountPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/users" replace /> },
]);
