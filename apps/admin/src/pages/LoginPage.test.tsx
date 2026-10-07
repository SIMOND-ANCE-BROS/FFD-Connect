import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { API_ORIGIN } from '../config';
import { useSession } from '../session/sessionStore';
import { LoginPage } from './LoginPage';

function renderLogin() {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/users" element={<p>users page</p>} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
}

async function submit() {
  await userEvent.type(await screen.findByLabelText(/email/i), 'a@x.fr');
  await userEvent.type(screen.getByLabelText(/mot de passe/i), 'secret');
  await userEvent.click(screen.getByRole('button', { name: /se connecter/i }));
}

const loginOk = (role: string) => ({
  data: {
    access_token: 'at',
    refresh_token: 'rt',
    user: { id: 'a1', email: 'a@x.fr', firstName: 'G', lastName: 'S', role },
  },
  error: undefined,
  response: new Response(null, { status: 200 }),
});

describe('LoginPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSession.getState().clear();
    vi.spyOn(sdk, 'healthControllerCheck').mockResolvedValue({
      data: {},
      error: undefined,
    } as never);
  });

  it('logs an ADMIN in and goes to /users', async () => {
    const login = vi.spyOn(sdk, 'authControllerLogin').mockResolvedValue(loginOk('ADMIN') as never);
    renderLogin();
    await submit();
    expect(await screen.findByText('users page')).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith({ body: { username: 'a@x.fr', password: 'secret' } });
    expect(useSession.getState().user?.role).toBe('ADMIN');
  });

  it('refuses a non-admin and keeps no session', async () => {
    vi.spyOn(sdk, 'authControllerLogin').mockResolvedValue(loginOk('CLUB') as never);
    renderLogin();
    await submit();
    expect(await screen.findByText(/réservé aux administrateurs/i)).toBeInTheDocument();
    expect(useSession.getState().accessToken).toBeNull();
  });

  it('shows invalid credentials on 401', async () => {
    vi.spyOn(sdk, 'authControllerLogin').mockResolvedValue({
      data: undefined,
      error: { message: 'Invalid credentials' },
      response: new Response(null, { status: 401 }),
    } as never);
    renderLogin();
    await submit();
    expect(await screen.findByText(/identifiants incorrects/i)).toBeInTheDocument();
  });

  it('reports an unavailable server (not a password error) on network failure', async () => {
    // Real shape: the generated client catches fetch's TypeError (no response).
    vi.spyOn(sdk, 'authControllerLogin').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
      response: undefined,
    } as never);
    renderLogin();
    await submit();
    expect(await screen.findByText('Serveur injoignable, réessayez dans un instant.')).toBeInTheDocument();
    expect(screen.queryByText(/identifiants incorrects/i)).toBeNull();
  });

  it('reports an unavailable server if the login call rejects', async () => {
    vi.spyOn(sdk, 'authControllerLogin').mockRejectedValue(new TypeError('Failed to fetch'));
    renderLogin();
    await submit();
    expect(await screen.findByText('Serveur injoignable, réessayez dans un instant.')).toBeInTheDocument();
    expect(screen.queryByText(/identifiants incorrects/i)).toBeNull();
  });

  it('wakes the backend on the origin /health, outside the /api/v1 prefix', async () => {
    renderLogin();
    await screen.findByRole('button', { name: /se connecter/i });
    expect(sdk.healthControllerCheck).toHaveBeenCalledWith({ baseUrl: API_ORIGIN });
    expect(API_ORIGIN).not.toMatch(/\/api\/v1\/?$/);
  });

  it('shows the wake-up state while the server is cold', async () => {
    let wake: () => void = () => {};
    vi.spyOn(sdk, 'healthControllerCheck').mockReturnValue(
      new Promise((resolve) => {
        wake = () => resolve({ data: {}, error: undefined } as never);
      }) as never,
    );
    renderLogin();
    expect(await screen.findByText(/réveil du serveur/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /se connecter/i })).toBeDisabled();
    wake();
    expect(await screen.findByRole('button', { name: /se connecter/i })).toBeEnabled();
  });
});
