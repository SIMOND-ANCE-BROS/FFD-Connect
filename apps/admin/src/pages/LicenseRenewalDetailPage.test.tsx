import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { LicenseRenewalDetailPage } from './LicenseRenewalDetailPage';

const pending = {
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
  rejectionReason: null,
  reviewComment: null,
  documents: [
    {
      id: 'd1',
      type: 'MEDICAL_CERTIFICATE',
      createdAt: '2026-10-08T08:30:00.000Z',
      ocr: { isApte: false, date: '2026-09-01', doctorName: 'Dr Durand' },
    },
    {
      id: 'd2',
      type: 'LICENSE_CERTIFICATE',
      createdAt: '2026-10-08T08:40:00.000Z',
      ocr: { licenseNumber: 'FFD-777' },
    },
  ],
  renewsUntil: '2027-08-31T21:59:59.999Z',
  history: [
    {
      id: 'r0',
      status: 'REJECTED',
      createdAt: '2025-09-01T08:00:00.000Z',
      submittedAt: '2025-09-01T09:00:00.000Z',
      reviewedAt: '2025-09-02T09:00:00.000Z',
    },
  ],
};

const rejected = {
  ...pending,
  status: 'REJECTED',
  reviewedAt: '2026-10-09T14:30:00.000Z',
  reviewedBy: { id: 'a1', firstName: 'Gabin', lastName: 'S' },
  rejectionReason: 'CERTIFICATE_TOO_OLD',
  reviewComment: 'Merci de déposer un certificat récent',
  renewsUntil: null,
  documents: pending.documents.map((d) => ({ ...d, ocr: null })),
};

const ok = (data: unknown) => ({ data, error: undefined });

function renderPage(item: object) {
  const detail = vi
    .spyOn(sdk, 'adminLicenseRenewalsControllerDetail')
    .mockResolvedValue(ok(item) as never);
  vi.spyOn(sdk, 'adminLicenseRenewalsControllerList').mockResolvedValue(
    ok({ data: [], meta: { total: 0, skip: 0, take: 1, hasMore: false } }) as never,
  );
  render(
    <MantineProvider>
      <Notifications />
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/license-renewals/r1']}>
          <Routes>
            <Route path="/license-renewals/:id" element={<LicenseRenewalDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return { detail };
}

describe('LicenseRenewalDetailPage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows the OCR readings as hints, never as a verdict, and loads no document by itself', async () => {
    const file = vi.spyOn(sdk, 'adminLicenseRenewalsControllerDocumentFile');
    renderPage(pending);
    expect(await screen.findByRole('heading', { name: 'Eva Martin' })).toBeInTheDocument();
    expect(screen.getAllByText(/Indices lus automatiquement, à vérifier/).length).toBe(2);
    expect(screen.getByText('Aptitude lue : non')).toBeInTheDocument();
    expect(screen.getByText('Médecin lu : Dr Durand')).toBeInTheDocument();
    expect(screen.getByText('Numéro lu : FFD-777')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Afficher le document' })).toHaveLength(2);
    expect(file).not.toHaveBeenCalled();
    expect(screen.getByText(/Refusée · soumise le 01\/09\/2025/)).toBeInTheDocument();
  });

  it('approves with the prefilled number, as confirmed by the admin', async () => {
    renderPage(pending);
    const approve = vi
      .spyOn(sdk, 'adminLicenseRenewalsControllerApprove')
      .mockResolvedValue(ok({ ...pending, status: 'APPROVED', renewsUntil: null }) as never);
    const number = await screen.findByLabelText('Numéro de licence');
    expect(number).toHaveValue('FFD-777');
    await userEvent.clear(number);
    await userEvent.type(number, 'FFD-778');
    await userEvent.click(screen.getByRole('button', { name: 'Approuver' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('La licence n° FFD-778 sera renouvelée jusqu’au 31/08/2027.'),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    await waitFor(() =>
      expect(approve).toHaveBeenCalledWith({
        path: { id: 'r1' },
        body: { licenseNumber: 'FFD-778' },
      }),
    );
    expect(await screen.findByText('Renouvellement approuvé')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approuver' })).toBeNull());
  });

  it('cannot refuse without a reason, and warns against any medical detail', async () => {
    renderPage(pending);
    const reject = vi
      .spyOn(sdk, 'adminLicenseRenewalsControllerReject')
      .mockResolvedValue(ok(rejected) as never);
    const refuse = await screen.findByRole('button', { name: 'Refuser' });
    expect(refuse).toBeDisabled();
    expect(screen.getByText(/Ne saisissez aucun détail médical/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Certificat trop ancien' }));
    await userEvent.type(
      screen.getByLabelText('Commentaire au licencié (facultatif)'),
      '  Merci de déposer un certificat récent  ',
    );
    await userEvent.click(refuse);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    await waitFor(() =>
      expect(reject).toHaveBeenCalledWith({
        path: { id: 'r1' },
        body: { reason: 'CERTIFICATE_TOO_OLD', comment: 'Merci de déposer un certificat récent' },
      }),
    );
  });

  it('409: shows the message and reloads the request', async () => {
    const { detail } = renderPage(pending);
    vi.spyOn(sdk, 'adminLicenseRenewalsControllerApprove').mockResolvedValue({
      data: undefined,
      error: { statusCode: 409, message: 'Cette demande a déjà été traitée.' },
    } as never);
    await userEvent.click(await screen.findByRole('button', { name: 'Approuver' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByText('Cette demande a déjà été traitée.')).toBeInTheDocument();
    await waitFor(() => expect(detail).toHaveBeenCalledTimes(2));
  });

  it('a decided request is read-only: decision, reason, comment, no document', async () => {
    renderPage(rejected);
    expect(await screen.findByText(/Refusée par Gabin S le 09\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByText('Motif : Certificat trop ancien')).toBeInTheDocument();
    expect(
      screen.getByText('Commentaire : Merci de déposer un certificat récent'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refuser' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Afficher le document' })).toBeNull();
  });
});
