import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { pendingCountQuery, renewalsPendingCountQuery } from '../api/queries';
import { AppLayout } from './AppLayout';

const countSpy = (count: number) =>
  vi
    .spyOn(sdk, 'trackCorrectionsControllerPendingCount')
    .mockResolvedValue({ data: { count }, error: undefined } as never);

const renewalsSpy = (total: number) =>
  vi.spyOn(sdk, 'adminLicenseRenewalsControllerList').mockResolvedValue({
    data: { data: [], meta: { total, skip: 0, take: 1, hasMore: total > 0 } },
    error: undefined,
  } as never);

function renderLayout() {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/users']}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/users" element={<p>content</p>} />
              <Route path="/clubs" element={<p>clubs page</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe('AppLayout', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    renewalsSpy(0);
  });

  it('lists the sections of the back-office, without a "new user" shortcut', async () => {
    countSpy(0);
    renderLayout();
    expect(screen.getByRole('link', { name: 'Utilisateurs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clubs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Musiques' })).toHaveAttribute('href', '/tracks');
    const order = screen.getAllByRole('link').map((link) => link.textContent);
    expect(order.indexOf('Musiques')).toBe(order.indexOf('Clubs') + 1);
    expect(screen.getByRole('link', { name: 'Modération' })).toHaveAttribute('href', '/moderation');
    expect(screen.getByRole('link', { name: "Journal d'audit" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Statistiques' })).toHaveAttribute('href', '/stats');
    expect(screen.getByRole('link', { name: "Usage de l'app" })).toHaveAttribute('href', '/usage');
    expect(screen.queryByText('Nouvel utilisateur')).toBeNull();
    expect(screen.getByText('content')).toBeInTheDocument();
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

  it('refreshes the count on navigation, never on a timer', async () => {
    const spy = countSpy(3);
    renderLayout();
    await screen.findByText('3');
    expect(spy).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('link', { name: 'Clubs' }));
    expect(await screen.findByText('clubs page')).toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(pendingCountQuery.refetchInterval).toBeUndefined();
    expect(pendingCountQuery.refetchOnWindowFocus).toBe(false);
    expect(pendingCountQuery.refetchOnReconnect).toBe(false);
    expect(pendingCountQuery.retry).toBe(false);
  });

  it('links « Renouvellements » and badges it with the pending renewals (#267)', async () => {
    countSpy(0);
    const spy = renewalsSpy(4);
    renderLayout();
    const link = screen.getByRole('link', { name: /^Renouvellements/ });
    expect(link).toHaveAttribute('href', '/license-renewals');
    expect(await within(link).findByText('4')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith({ query: { status: 'PENDING', take: 1 } });
  });

  it('shows no renewal badge when nothing is pending', async () => {
    countSpy(0);
    const spy = renewalsSpy(0);
    renderLayout();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const link = screen.getByRole('link', { name: /^Renouvellements/ });
    expect(within(link).queryByText('0')).toBeNull();
  });

  it('refreshes the renewal count on navigation, never on a timer', async () => {
    countSpy(0);
    const spy = renewalsSpy(2);
    renderLayout();
    await screen.findByText('2');
    expect(spy).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('link', { name: 'Clubs' }));
    expect(await screen.findByText('clubs page')).toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(renewalsPendingCountQuery.refetchInterval).toBeUndefined();
    expect(renewalsPendingCountQuery.refetchOnWindowFocus).toBe(false);
    expect(renewalsPendingCountQuery.refetchOnReconnect).toBe(false);
    expect(renewalsPendingCountQuery.retry).toBe(false);
  });
});
