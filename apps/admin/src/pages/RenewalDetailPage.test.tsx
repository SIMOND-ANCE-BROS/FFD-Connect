import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { renewalQuery } from '../api/queries';
import { RenewalDetailPage } from './RenewalDetailPage';

const pending = {
  id: 'r1',
  status: 'PENDING',
  createdAt: '2026-10-01T10:00:00.000Z',
  submittedAt: '2026-10-01T10:05:00.000Z',
  reviewedAt: null,
  user: {
    id: 'u1',
    firstName: 'Eva',
    lastName: 'Martin',
    license: { number: 'OLD-1', validUntil: '2026-08-31T12:00:00.000Z' },
  },
  reviewedBy: null,
  rejectionReason: null,
  reviewComment: null,
  documents: [
    {
      id: 'd1',
      type: 'MEDICAL_CERTIFICATE',
      createdAt: '2026-10-01T10:00:00.000Z',
      ocr: { isApte: true, date: '2026-09-15', doctorName: 'Dr Durand' },
    },
    {
      id: 'd2',
      type: 'LICENSE_CERTIFICATE',
      createdAt: '2026-10-01T10:01:00.000Z',
      ocr: { licenseNumber: 'FFD-2027' },
    },
  ],
  renewsUntil: '2027-08-31T12:00:00.000Z',
  history: [
    {
      id: 'r0',
      status: 'APPROVED',
      createdAt: '2025-09-01T10:00:00.000Z',
      submittedAt: '2025-09-01T10:05:00.000Z',
      reviewedAt: '2025-09-02T10:00:00.000Z',
    },
  ],
};

const decided = (status: 'APPROVED' | 'REJECTED', extra: object = {}) => ({
  ...pending,
  status,
  reviewedAt: '2026-10-02T09:30:00.000Z',
  reviewedBy: { id: 'a1', firstName: 'Gabin', lastName: 'S' },
  documents: pending.documents.map((d) => ({ ...d, ocr: null })),
  renewsUntil: null,
  ...extra,
});

const ok = (data: unknown) => ({ data, error: undefined });
const fail = (statusCode: number, message: string) => ({
  data: undefined,
  error: { statusCode, message },
  response: new Response(null, { status: statusCode }),
});

/** Picks an option in a Mantine Select (every listbox stays mounted in jsdom). */
async function pickOption(input: HTMLElement, name: string) {
  await userEvent.click(input);
  const listbox = document.getElementById(input.getAttribute('aria-controls') ?? '');
  if (!listbox) throw new Error('listbox not found');
  await userEvent.click(within(listbox).getByRole('option', { name, hidden: true }));
}

function renderPage(item: object) {
  const detail = vi
    .spyOn(sdk, 'adminLicenseRenewalsControllerDetail')
    .mockResolvedValue(ok(item) as never);
  vi.spyOn(sdk, 'adminLicenseRenewalsControllerList').mockResolvedValue(
    ok({ data: [], meta: { total: 0, skip: 0, take: 1, hasMore: false } }) as never,
  );
  const view = render(
    <MantineProvider>
      <Notifications />
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/license-renewals/r1']}>
          <Routes>
            <Route path="/license-renewals/:id" element={<RenewalDetailPage />} />
            <Route path="/license-renewals" element={<p>liste</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return { ...view, detail };
}

const fileSpy = (blob: Blob) =>
  vi.spyOn(sdk, 'adminLicenseRenewalsControllerDocumentFile').mockResolvedValue(ok(blob) as never);

async function submit(decision: 'Approuver' | 'Refuser') {
  await userEvent.click(screen.getByRole('button', { name: decision }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
  return dialog;
}

describe('RenewalDetailPage', () => {
  let createUrl: ReturnType<typeof vi.fn>;
  let revokeUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    let n = 0;
    createUrl = vi.fn(() => `blob:admin/${++n}`);
    revokeUrl = vi.fn();
    // jsdom has no object URLs.
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
  });

  it('shows the request, the OCR readings as hints and the history', async () => {
    renderPage(pending);
    expect(await screen.findByRole('heading', { name: 'Eva Martin' })).toBeInTheDocument();
    expect(screen.getByText('À traiter')).toBeInTheDocument();
    expect(screen.getByText("OLD-1, valable jusqu'au 31/08/2026")).toBeInTheDocument();
    expect(screen.getByText("Licence valable jusqu'au 31/08/2027")).toBeInTheDocument();
    const hints = screen.getByRole('table', { name: 'Indices OCR — Certificat médical' });
    expect(within(hints).getByText('Mention « apte »')).toBeInTheDocument();
    expect(within(hints).getByText('lue sur le document')).toBeInTheDocument();
    expect(within(hints).getByText('15/09/2026')).toBeInTheDocument();
    expect(within(hints).getByText('Dr Durand')).toBeInTheDocument();
    expect(
      screen.getAllByText("Lus par l'OCR, sans valeur de décision : vérifiez-les sur le document."),
    ).toHaveLength(2);
    const history = screen.getByRole('table', { name: 'Demandes précédentes' });
    expect(within(history).getByRole('link', { name: 'Approuvée' })).toHaveAttribute(
      'href',
      '/license-renewals/r0',
    );
  });

  it('never loads a document without a click', async () => {
    const file = fileSpy(new Blob(['x'], { type: 'image/png' }));
    renderPage(pending);
    await screen.findByRole('heading', { name: 'Eva Martin' });
    expect(file).not.toHaveBeenCalled();
    expect(createUrl).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('fetches the file on click, uncached, shows it from an object URL revoked on leave', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const file = fileSpy(blob);
    const { unmount } = renderPage(pending);
    const [medical] = await screen.findAllByRole('button', { name: 'Afficher le document' });
    await userEvent.click(medical!);
    expect(file).toHaveBeenCalledWith({
      path: { id: 'r1', docId: 'd1' },
      parseAs: 'blob',
      cache: 'no-store',
    });
    const img = await screen.findByRole('img', { name: 'Certificat médical' });
    expect(img).toHaveAttribute('src', 'blob:admin/1');
    expect(createUrl).toHaveBeenCalledWith(blob);
    expect(revokeUrl).not.toHaveBeenCalled();
    unmount();
    expect(revokeUrl).toHaveBeenCalledWith('blob:admin/1');
  });

  it('revokes the object URL when the admin goes back to the list', async () => {
    fileSpy(new Blob(['x'], { type: 'image/png' }));
    renderPage(pending);
    const [medical] = await screen.findAllByRole('button', { name: 'Afficher le document' });
    await userEvent.click(medical!);
    await screen.findByRole('img', { name: 'Certificat médical' });
    await userEvent.click(screen.getByRole('link', { name: 'Retour à la liste' }));
    expect(await screen.findByText('liste')).toBeInTheDocument();
    expect(revokeUrl).toHaveBeenCalledWith('blob:admin/1');
  });

  it('revokes the object URL when the document is hidden, and refetches on the next click', async () => {
    const file = fileSpy(new Blob(['x'], { type: 'application/pdf' }));
    renderPage(pending);
    const [, licence] = await screen.findAllByRole('button', { name: 'Afficher le document' });
    await userEvent.click(licence!);
    const frame = await screen.findByTitle('Attestation de licence');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', 'blob:admin/1');
    await userEvent.click(screen.getByRole('button', { name: 'Masquer le document' }));
    expect(revokeUrl).toHaveBeenCalledWith('blob:admin/1');
    expect(screen.queryByTitle('Attestation de licence')).toBeNull();
    const buttons = screen.getAllByRole('button', { name: 'Afficher le document' });
    await userEvent.click(buttons[1]!);
    await screen.findByTitle('Attestation de licence');
    expect(file).toHaveBeenCalledTimes(2);
  });

  it('never renders a file of an unexpected type', async () => {
    fileSpy(new Blob(['<script></script>'], { type: 'text/html' }));
    renderPage(pending);
    const [medical] = await screen.findAllByRole('button', { name: 'Afficher le document' });
    await userEvent.click(medical!);
    expect(await screen.findByText(/Format de document non pris en charge/)).toBeInTheDocument();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('creates no object URL when the page is left during the download', async () => {
    let resolve: (value: unknown) => void = () => {};
    vi.spyOn(sdk, 'adminLicenseRenewalsControllerDocumentFile').mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }) as never,
    );
    const { unmount } = renderPage(pending);
    const [medical] = await screen.findAllByRole('button', { name: 'Afficher le document' });
    await userEvent.click(medical!);
    unmount();
    resolve(ok(new Blob(['x'], { type: 'image/png' })));
    await new Promise((r) => setTimeout(r, 0));
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('explains a 410 (request decided meanwhile)', async () => {
    vi.spyOn(sdk, 'adminLicenseRenewalsControllerDocumentFile').mockResolvedValue(
      fail(410, 'La demande a été traitée : ses documents ne sont plus consultables.') as never,
    );
    renderPage(pending);
    const [medical] = await screen.findAllByRole('button', { name: 'Afficher le document' });
    await userEvent.click(medical!);
    expect(
      await screen.findByText(
        'La demande a été traitée : ses documents ne sont plus consultables.',
      ),
    ).toBeInTheDocument();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('approves with the prefilled licence number, edited and confirmed by the admin', async () => {
    const approve = vi
      .spyOn(sdk, 'adminLicenseRenewalsControllerApprove')
      .mockResolvedValue(ok(decided('APPROVED')) as never);
    renderPage(pending);
    const number = await screen.findByLabelText(/Numéro de licence/);
    expect(number).toHaveValue('FFD-2027');
    await userEvent.clear(number);
    await userEvent.type(number, ' FFD-2028 ');
    await userEvent.click(screen.getByRole('button', { name: 'Approuver' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      "La licence de Eva Martin sera renouvelée avec le numéro FFD-2028, jusqu'au 31/08/2027.",
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(approve).toHaveBeenCalledWith({
      path: { id: 'r1' },
      body: { licenseNumber: 'FFD-2028' },
    });
    expect(await screen.findByText(/Traitée par Gabin S le 02\/10\/2026/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approuver' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Afficher le document' })).toBeNull();
  });

  it('cannot approve without a licence number', async () => {
    renderPage({ ...pending, user: { ...pending.user, license: null }, documents: [] });
    const number = await screen.findByLabelText(/Numéro de licence/);
    expect(number).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Approuver' })).toBeDisabled();
  });

  it('cannot reject without a reason, warns against medical details', async () => {
    const reject = vi
      .spyOn(sdk, 'adminLicenseRenewalsControllerReject')
      .mockResolvedValue(
        ok(
          decided('REJECTED', { rejectionReason: 'ILLEGIBLE', reviewComment: 'Photo floue' }),
        ) as never,
      );
    renderPage(pending);
    await screen.findByRole('heading', { name: 'Eva Martin' });
    expect(
      screen.getByText(
        'Ne saisissez aucun détail médical : ce commentaire est transmis au licencié.',
      ),
    ).toBeInTheDocument();
    const refuse = screen.getByRole('button', { name: 'Refuser' });
    expect(refuse).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Commentaire/), '  Photo floue  ');
    expect(refuse).toBeDisabled();
    await pickOption(screen.getByRole('textbox', { name: /Motif du refus/ }), 'Document illisible');
    expect(refuse).toBeEnabled();
    await userEvent.click(refuse);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('La demande de Eva Martin sera refusée.');
    expect(dialog).toHaveTextContent('Motif : Document illisible');
    expect(dialog).toHaveTextContent('Commentaire : Photo floue');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(reject).toHaveBeenCalledWith({
      path: { id: 'r1' },
      body: { reason: 'ILLEGIBLE', comment: 'Photo floue' },
    });
    expect(await screen.findByText('Motif : Document illisible')).toBeInTheDocument();
  });

  it('rejects without a comment when none is typed', async () => {
    const reject = vi
      .spyOn(sdk, 'adminLicenseRenewalsControllerReject')
      .mockResolvedValue(ok(decided('REJECTED', { rejectionReason: 'OTHER' })) as never);
    renderPage(pending);
    await pickOption(await screen.findByRole('textbox', { name: /Motif du refus/ }), 'Autre motif');
    await submit('Refuser');
    expect(reject).toHaveBeenCalledWith({ path: { id: 'r1' }, body: { reason: 'OTHER' } });
  });

  it('on a 409 says the request was already processed and reloads it', async () => {
    vi.spyOn(sdk, 'adminLicenseRenewalsControllerApprove').mockResolvedValue(
      fail(409, 'Cette demande de renouvellement a déjà été traitée.') as never,
    );
    const { detail } = renderPage(pending);
    await screen.findByLabelText(/Numéro de licence/);
    detail.mockResolvedValue(ok(decided('REJECTED', { rejectionReason: 'OTHER' })) as never);
    await submit('Approuver');
    expect(
      await screen.findByText(/Cette demande de renouvellement a déjà été traitée\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/L'état de la demande a été rechargé/)).toBeInTheDocument();
    await waitFor(() => expect(detail).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Traitée par Gabin S/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the form on a 409 that leaves the request pending (number already taken)', async () => {
    vi.spyOn(sdk, 'adminLicenseRenewalsControllerApprove').mockResolvedValue(
      fail(409, 'Ce numéro de licence est déjà attribué à un autre compte.') as never,
    );
    const { detail } = renderPage(pending);
    await screen.findByLabelText(/Numéro de licence/);
    await submit('Approuver');
    expect(
      await screen.findByText(/Ce numéro de licence est déjà attribué à un autre compte\./),
    ).toBeInTheDocument();
    await waitFor(() => expect(detail).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText(/Numéro de licence/)).toHaveValue('FFD-2027');
  });

  it('shows any other error in the dialog', async () => {
    vi.spyOn(sdk, 'adminLicenseRenewalsControllerApprove').mockResolvedValue(
      fail(400, 'licenseNumber contient des caractères non autorisés') as never,
    );
    renderPage(pending);
    await screen.findByLabelText(/Numéro de licence/);
    const dialog = await submit('Approuver');
    expect(
      await within(dialog).findByText('licenseNumber contient des caractères non autorisés'),
    ).toBeInTheDocument();
  });

  it('shows a decided request read-only, documents closed', async () => {
    renderPage(
      decided('REJECTED', {
        rejectionReason: 'CERTIFICATE_TOO_OLD',
        reviewComment: 'Daté de 2024',
      }),
    );
    expect(await screen.findByText('Refusée')).toBeInTheDocument();
    expect(screen.getByText('Motif : Certificat trop ancien')).toBeInTheDocument();
    expect(screen.getByText('Commentaire : Daté de 2024')).toBeInTheDocument();
    expect(
      screen.getByText('La demande a été traitée : ses documents ne sont plus consultables.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Afficher le document' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approuver' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refuser' })).toBeNull();
  });

  it('names the automatic approval', async () => {
    renderPage(decided('APPROVED', { reviewedBy: null }));
    expect(await screen.findByText(/Traitée par Approbation automatique/)).toBeInTheDocument();
  });

  it('never refetches the audited detail behind the admin', () => {
    expect(renewalQuery('r1')).toMatchObject({
      queryKey: ['admin', 'renewals', 'item', 'r1'],
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    });
  });
});
