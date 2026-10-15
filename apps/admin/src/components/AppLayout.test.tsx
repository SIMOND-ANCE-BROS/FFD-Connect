import { screen, waitFor, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { renderWithProviders, setupUser } from '../test/render';
import { pendingCountQuery } from '../api/queries';
import { useSession } from '../session/sessionStore';
import { AppLayout, NAV_ITEMS } from './AppLayout';

const countSpy = (count: number) =>
  vi
    .spyOn(sdk, 'trackCorrectionsControllerPendingCount')
    .mockResolvedValue({ data: { count }, error: undefined } as never);

/** The renewals badge reads the total of a one-row PENDING page. */
const renewalsSpy = (total: number) =>
  vi.spyOn(sdk, 'adminLicenseRenewalsControllerList').mockResolvedValue({
    data: { data: [], meta: { total, skip: 0, take: 1, hasMore: total > 1 } },
    error: undefined,
  } as never);

function renderLayout(path = '/users') {
  return renderWithProviders(
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/users" element={<p>content</p>} />
        <Route path="/users/:id" element={<p>user page</p>} />
        <Route path="/clubs" element={<p>clubs page</p>} />
      </Route>
      <Route path="/login" element={<p>login page</p>} />
    </Routes>,
    { route: path },
  );
}

let user: UserEvent;

describe('AppLayout', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    user = setupUser();
    renewalsSpy(0);
  });

  it('lists the sections of the back-office, without a "new user" shortcut', async () => {
    countSpy(0);
    renderLayout();
    expect(screen.getByRole('link', { name: 'Tableau de bord' })).toHaveAttribute('href', '/');
    expect(screen.getAllByRole('link')[0]).toHaveTextContent('Tableau de bord');
    expect(screen.getByRole('link', { name: 'Utilisateurs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clubs' })).toBeInTheDocument();
    const music = screen.getByRole('group', { name: 'Musiques' });
    expect(within(music).getByRole('link', { name: 'Bibliothèque' })).toHaveAttribute(
      'href',
      '/tracks',
    );
    expect(within(music).getByRole('link', { name: 'Modération' })).toHaveAttribute(
      'href',
      '/moderation',
    );
    const order = screen.getAllByRole('link').map((link) => link.textContent);
    expect(order.indexOf('Bibliothèque')).toBe(order.indexOf('Clubs') + 1);
    expect(order.indexOf('Modération')).toBe(order.indexOf('Bibliothèque') + 1);
    expect(screen.getByRole('link', { name: 'Renouvellements' })).toHaveAttribute(
      'href',
      '/license-renewals',
    );
    expect(order.indexOf('Renouvellements')).toBe(order.indexOf('Modération') + 1);
    expect(screen.getByRole('link', { name: "Journal d'audit" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Statistiques' })).toHaveAttribute('href', '/stats');
    expect(screen.getByRole('link', { name: "Usage de l'app" })).toHaveAttribute('href', '/usage');
    expect(screen.queryByText('Nouvel utilisateur')).toBeNull();
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('badges « Renouvellements » with the requests to process, refreshed on navigation', async () => {
    countSpy(0);
    const spy = renewalsSpy(2);
    renderLayout();
    const link = screen.getByRole('link', { name: /^Renouvellements/ });
    expect(await within(link).findByText('2')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith({ query: { status: 'PENDING', take: 1 } });
    await user.click(screen.getByRole('link', { name: 'Clubs' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it('badges « Modération » with the pending count', async () => {
    countSpy(3);
    renderLayout();
    const link = screen.getByRole('link', { name: /^Modération/ });
    expect(await within(link).findByText('3')).toBeInTheDocument();
  });

  it('shows no badge when nothing is pending', async () => {
    const spy = countSpy(0);
    renderLayout();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const link = screen.getByRole('link', { name: /^Modération/ });
    expect(within(link).queryByText('0')).toBeNull();
  });

  it('opens the phone menu with the burger and closes it on navigation', async () => {
    countSpy(0);
    renderLayout();
    const burger = screen.getByRole('button', { name: 'Ouvrir le menu' });
    expect(burger).toHaveAttribute('aria-expanded', 'false');
    expect(burger).toHaveAttribute('aria-controls', 'admin-navbar');
    await user.click(burger);
    expect(screen.getByRole('button', { name: 'Fermer le menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await user.click(screen.getByRole('link', { name: 'Clubs' }));
    expect(await screen.findByText('clubs page')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ouvrir le menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('closes the phone menu when tapping the current section again', async () => {
    countSpy(0);
    renderLayout();
    await user.click(screen.getByRole('button', { name: 'Ouvrir le menu' }));
    await user.click(screen.getByRole('link', { name: 'Utilisateurs' }));
    expect(screen.getByRole('button', { name: 'Ouvrir le menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('groups the music library and its moderation under « Musiques »', () => {
    countSpy(0);
    renderLayout('/users');
    expect(NAV_ITEMS.find((i) => i.label === 'Musiques')).toMatchObject({
      children: [{ to: '/tracks' }, { to: '/moderation', queue: 'moderation' }],
    });
    expect(screen.queryByRole('link', { name: 'Musiques' })).toBeNull();
  });

  it('marks the current section as active, including its sub-pages', () => {
    countSpy(0);
    renderLayout('/users/42');
    expect(screen.getByRole('link', { name: 'Utilisateurs' })).toHaveAttribute('data-active');
    expect(screen.getByRole('link', { name: 'Clubs' })).not.toHaveAttribute('data-active');
    // The dashboard is `/`: it must not light up for every page.
    expect(screen.getByRole('link', { name: 'Tableau de bord' })).not.toHaveAttribute(
      'data-active',
    );
  });

  it('keeps the menu in a single list, in display order', () => {
    expect(
      NAV_ITEMS.flatMap((i) => ('children' in i ? i.children.map((c) => c.to) : [i.to])),
    ).toEqual([
      '/',
      '/users',
      '/clubs',
      '/tracks',
      '/moderation',
      '/license-renewals',
      '/refunds-due',
      '/audit-log',
      '/health-data-access-log',
      '/stats',
      '/usage',
    ]);
  });

  it('logs out from the header', async () => {
    countSpy(0);
    useSession.getState().setSession({
      accessToken: 'a',
      refreshToken: 'r',
      user: { id: 'u1', email: 'a@x.fr', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN' },
    });
    renderLayout();
    // The header button (desktop) and the menu footer button (phone) share the action.
    const [logout] = screen.getAllByRole('button', { name: 'Déconnexion' });
    await user.click(logout);
    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(useSession.getState().user).toBeNull();
  });

  it('refreshes the count on navigation, never on a timer', async () => {
    const spy = countSpy(3);
    renderLayout();
    await screen.findByText('3');
    expect(spy).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('link', { name: 'Clubs' }));
    expect(await screen.findByText('clubs page')).toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(pendingCountQuery.refetchInterval).toBeUndefined();
    expect(pendingCountQuery.refetchOnWindowFocus).toBe(false);
    expect(pendingCountQuery.refetchOnReconnect).toBe(false);
    expect(pendingCountQuery.retry).toBe(false);
  });
});
