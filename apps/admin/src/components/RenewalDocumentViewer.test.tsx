import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { RenewalDocumentViewer } from './RenewalDocumentViewer';

const doc = { id: 'd1', type: 'MEDICAL_CERTIFICATE' as const };

function renderViewer() {
  return render(
    <MantineProvider>
      <RenewalDocumentViewer requestId="r1" document={doc} />
    </MantineProvider>,
  );
}

describe('RenewalDocumentViewer', () => {
  const createObjectURL = vi.fn(() => 'blob:certificate-1');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });

  it('never loads the certificate without a click', () => {
    const file = vi.spyOn(sdk, 'adminLicenseRenewalsControllerDocumentFile');
    renderViewer();
    expect(screen.getByRole('button', { name: 'Afficher le document' })).toBeInTheDocument();
    expect(file).not.toHaveBeenCalled();
  });

  it('fetches it authenticated, uncached, as a blob, and shows an image in place', async () => {
    const file = vi.spyOn(sdk, 'adminLicenseRenewalsControllerDocumentFile').mockResolvedValue({
      data: new Blob(['x'], { type: 'image/jpeg' }),
      error: undefined,
    } as never);
    renderViewer();
    await userEvent.click(screen.getByRole('button', { name: 'Afficher le document' }));
    expect(await screen.findByRole('img', { name: 'Certificat médical' })).toHaveAttribute(
      'src',
      'blob:certificate-1',
    );
    expect(file).toHaveBeenCalledWith({
      path: { id: 'r1', docId: 'd1' },
      parseAs: 'blob',
      cache: 'no-store',
    });
  });

  it('shows a PDF in a frame', async () => {
    vi.spyOn(sdk, 'adminLicenseRenewalsControllerDocumentFile').mockResolvedValue({
      data: new Blob(['%PDF'], { type: 'application/pdf' }),
      error: undefined,
    } as never);
    renderViewer();
    await userEvent.click(screen.getByRole('button', { name: 'Afficher le document' }));
    expect(await screen.findByTitle('Certificat médical')).toHaveAttribute(
      'src',
      'blob:certificate-1',
    );
  });

  it('revokes the object URL when leaving the page', async () => {
    vi.spyOn(sdk, 'adminLicenseRenewalsControllerDocumentFile').mockResolvedValue({
      data: new Blob(['x'], { type: 'image/png' }),
      error: undefined,
    } as never);
    const view = renderViewer();
    await userEvent.click(screen.getByRole('button', { name: 'Afficher le document' }));
    await screen.findByRole('img', { name: 'Certificat médical' });
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:certificate-1');
  });

  it('explains a request already decided (410)', async () => {
    vi.spyOn(sdk, 'adminLicenseRenewalsControllerDocumentFile').mockResolvedValue({
      data: undefined,
      error: { statusCode: 410, message: 'Demande traitée' },
    } as never);
    renderViewer();
    await userEvent.click(screen.getByRole('button', { name: 'Afficher le document' }));
    expect(
      await screen.findByText('Demande déjà traitée : le document n’est plus consultable.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(createObjectURL).not.toHaveBeenCalled());
  });
});
