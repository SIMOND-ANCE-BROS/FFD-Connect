import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { renewalsListQuery } from '../api/queries';
import { RenewalsPage } from './RenewalsPage';

const item = (overrides: Record<string, unknown> = {}) => ({
  id: 'r1',
  status: 'PENDING',
  createdAt: '2026-10-01T10:00:00.000Z',
  submittedAt: '2026-10-01T10:05:00.000Z',
  reviewedAt: null,
  user: {
    id: 'u1',
    firstName: 'Eva',
    lastName: 'Martin',
    license: { number: 'FFD-123', validUntil: '2026-08-31T21:59:59.999Z' },
  },
  reviewedBy: null,
  documents: [
    { id: 'd1', type: 'MEDICAL_CERTIFICATE', createdAt: '2026-10-01T10:00:00.000Z' },
    { id: 'd2', type: 'LICENSE_CERTIFICATE', createdAt: '2026-10-01T10:01:00.000Z' },
  ],
  ...overrides,
});

const page = (data: object[], total = data.length) => ({
  data: { data, meta: { total, skip: 0, take: 50, hasMore: total > data.length } },
  error: undefined,
});

function Probe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderPage(path = '/license-renewals') {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/license-renewals"
              element={
                <>
                  <RenewalsPage />
                  <Probe />
                </>
              }
            />
            <Route path="/license-renewals/:id" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe('RenewalsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('opens on « À traiter » and lists the pending queue', async () => {
    const list = vi
      .spyOn(sdk, 'adminLicenseRenewalsControllerList')
      .mockResolvedValue(page([item()]) as never);
    renderPage();
    expect(await screen.findByText('Eva Martin')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ query: { status: 'PENDING', skip: 0, take: 50 } });
    expect(screen.getByRole('tab', { name: 'À traiter' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Certificat médical, Attestation de licence')).toBeInTheDocument();
    expect(screen.getByText(/FFD-123 \(jusqu'au 31\/08\/2026\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 demande, les plus anciennes en premier/)).toBeInTheDocument();
    // No decision columns on the queue.
    expect(screen.queryByRole('columnheader', { name: 'Traitée le' })).toBeNull();
  });

  it('switches tabs: approved and rejected requests show who decided and when', async () => {
    const list = vi.spyOn(sdk, 'adminLicenseRenewalsControllerList').mockImplementation(((options: {
      query: { status: string };
    }) =>
      Promise.resolve(
        options.query.status === 'APPROVED'
          ? page([
              item({
                id: 'r2',
                status: 'APPROVED',
                reviewedAt: '2026-10-02T09:00:00.000Z',
                reviewedBy: null,
              }),
            ])
          : options.query.status === 'REJECTED'
            ? page([
                item({
                  id: 'r3',
                  status: 'REJECTED',
                  reviewedAt: '2026-10-03T09:00:00.000Z',
                  reviewedBy: { id: 'a1', firstName: 'Gabin', lastName: 'S' },
                  user: { id: 'u2', firstName: 'Léo', lastName: 'Petit', license: null },
                }),
              ])
            : page([item()]),
      )) as never);
    renderPage();
    await screen.findByText('Eva Martin');

    await userEvent.click(screen.getByRole('tab', { name: 'Approuvées' }));
    expect(await screen.findByText('Approbation automatique')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/license-renewals?status=APPROVED');
    expect(screen.getByRole('columnheader', { name: 'Traitée le' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Refusées' }));
    expect(await screen.findByText('Léo Petit')).toBeInTheDocument();
    expect(screen.getByText('Gabin S')).toBeInTheDocument();
    expect(screen.getByText('Aucune')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ query: { status: 'REJECTED', skip: 0, take: 50 } });
  });

  it('opens a request with the list state kept in the URL', async () => {
    vi.spyOn(sdk, 'adminLicenseRenewalsControllerList').mockResolvedValue(
      page([item({ status: 'APPROVED' })]) as never,
    );
    renderPage('/license-renewals?status=APPROVED');
    await userEvent.click(await screen.findByText('Eva Martin'));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/license-renewals/r1?status=APPROVED',
    );
  });

  it('says when a tab is empty', async () => {
    vi.spyOn(sdk, 'adminLicenseRenewalsControllerList').mockResolvedValue(page([]) as never);
    renderPage();
    expect(await screen.findByText('Aucune demande')).toBeInTheDocument();
  });

  it('paginates beyond 50 requests', async () => {
    const list = vi
      .spyOn(sdk, 'adminLicenseRenewalsControllerList')
      .mockResolvedValue(page([item()], 120) as never);
    renderPage();
    await screen.findByText('Eva Martin');
    await userEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith({ query: { status: 'PENDING', skip: 50, take: 50 } }),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/license-renewals?page=2');
  });

  it('shows the API error', async () => {
    vi.spyOn(sdk, 'adminLicenseRenewalsControllerList').mockResolvedValue({
      data: undefined,
      error: { statusCode: 403, message: 'Accès refusé' },
    } as never);
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Accès refusé')).toBeInTheDocument();
  });

  it('never wakes the scale-to-zero backend on a refocus, a reconnect or a retry', () => {
    expect(renewalsListQuery({ status: 'PENDING' })).toMatchObject({
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    });
  });
});
