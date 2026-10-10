import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { LicenseRenewalsPage } from './LicenseRenewalsPage';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'r1',
  status: 'PENDING',
  createdAt: '2026-10-08T08:00:00.000Z',
  submittedAt: '2026-10-08T09:00:00.000Z',
  reviewedAt: null,
  user: {
    id: 'u1',
    firstName: 'Eva',
    lastName: 'Martin',
    license: { number: 'FFD-123', validUntil: '2026-08-31T21:59:59.999Z' },
  },
  reviewedBy: null,
  documents: [
    { id: 'd1', type: 'MEDICAL_CERTIFICATE', createdAt: '2026-10-08T08:30:00.000Z' },
    { id: 'd2', type: 'LICENSE_CERTIFICATE', createdAt: '2026-10-08T08:40:00.000Z' },
  ],
  ...overrides,
});

const page = (data: object[]) => ({
  data: { data, meta: { total: data.length, skip: 0, take: 50, hasMore: false } },
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
                  <LicenseRenewalsPage />
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

describe('LicenseRenewalsPage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('lists the requests to process by default', async () => {
    const list = vi
      .spyOn(sdk, 'adminLicenseRenewalsControllerList')
      .mockResolvedValue(page([row()]) as never);
    renderPage();
    expect(await screen.findByRole('link', { name: 'Eva Martin' })).toHaveAttribute(
      'href',
      '/users/u1',
    );
    expect(list).toHaveBeenCalledWith({ query: { status: 'PENDING', skip: 0, take: 50 } });
    expect(screen.getByText('FFD-123')).toBeInTheDocument();
    expect(screen.getByText('31/08/2026')).toBeInTheDocument();
    expect(screen.getByText('Certificat médical, Attestation de licence')).toBeInTheDocument();
    expect(screen.getByText(/08\/10\/2026/)).toBeInTheDocument();
  });

  it('switches tabs, kept in the URL, and shows who decided', async () => {
    const list = vi
      .spyOn(sdk, 'adminLicenseRenewalsControllerList')
      .mockResolvedValueOnce(page([row()]) as never)
      .mockResolvedValue(
        page([
          row({
            status: 'REJECTED',
            reviewedAt: '2026-10-09T14:30:00.000Z',
            reviewedBy: { id: 'a1', firstName: 'Gabin', lastName: 'S' },
          }),
        ]) as never,
      );
    renderPage();
    await screen.findByRole('link', { name: 'Eva Martin' });
    await userEvent.click(screen.getByText('Refusées'));
    expect(await screen.findByText('Gabin S')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/license-renewals?status=REJECTED');
    expect(list).toHaveBeenLastCalledWith({ query: { status: 'REJECTED', skip: 0, take: 50 } });
  });

  it('opens a request', async () => {
    vi.spyOn(sdk, 'adminLicenseRenewalsControllerList').mockResolvedValue(page([row()]) as never);
    renderPage();
    await userEvent.click(await screen.findByRole('link', { name: 'Traiter' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/license-renewals/r1'),
    );
  });

  it('says when nothing is waiting', async () => {
    vi.spyOn(sdk, 'adminLicenseRenewalsControllerList').mockResolvedValue(page([]) as never);
    renderPage();
    expect(await screen.findByText('Aucune demande')).toBeInTheDocument();
  });

  it('shows the shared unreachable-server message', async () => {
    vi.spyOn(sdk, 'adminLicenseRenewalsControllerList').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
    } as never);
    renderPage();
    expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument();
  });
});
