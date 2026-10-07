import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { RequireAdmin } from './RequireAdmin';
import { useSession } from './sessionStore';

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/users']}>
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route
          path="/users"
          element={
            <RequireAdmin>
              <p>secret</p>
            </RequireAdmin>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireAdmin', () => {
  it('redirects to /login once the session is cleared', () => {
    useSession.getState().clear();
    renderAt();
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('redirects a non-admin to /login', () => {
    useSession.getState().setSession({
      accessToken: 'a',
      refreshToken: 'r',
      user: { id: '1', email: 'a@x.fr', firstName: 'G', lastName: 'S', role: 'CLUB' },
    });
    renderAt();
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('renders children for an ADMIN', () => {
    useSession.getState().setSession({
      accessToken: 'a',
      refreshToken: 'r',
      user: { id: '1', email: 'a@x.fr', firstName: 'G', lastName: 'S', role: 'ADMIN' },
    });
    renderAt();
    expect(screen.getByText('secret')).toBeInTheDocument();
  });
});
