import { Alert, Box, Button, Stack } from '@mantine/core';
import { useEffect, useState } from 'react';
import { adminLicenseRenewalsControllerDocumentFile } from '../api/generated/sdk.gen';
import type { LicenseRenewalDocumentType } from '../api/generated/types.gen';
import { apiErrorMessage } from '../lib/apiError';
import { DOCUMENT_LABELS } from '../lib/licenseRenewals';

interface Props {
  requestId: string;
  document: { id: string; type: LicenseRenewalDocumentType };
}

type Loaded = { url: string; isPdf: boolean };

const isGone = (body: unknown): boolean =>
  typeof body === 'object' &&
  body !== null &&
  (body as { statusCode?: unknown }).statusCode === 410;

/**
 * A renewal document (health data, #267): loaded ONLY on click, through the
 * authenticated client, never cached; shown from an object URL that is
 * revoked when the page is left. Each opening is audited server-side.
 */
export function RenewalDocumentViewer({ requestId, document }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const label = DOCUMENT_LABELS[document.type];

  useEffect(
    () => () => {
      if (loaded) URL.revokeObjectURL(loaded.url);
    },
    [loaded],
  );

  const open = async () => {
    setLoading(true);
    setError(null);
    const { data, error: body } = await adminLicenseRenewalsControllerDocumentFile({
      path: { id: requestId, docId: document.id },
      parseAs: 'blob',
      cache: 'no-store',
    });
    setLoading(false);
    if (body !== undefined || !(data instanceof Blob)) {
      setError(
        isGone(body)
          ? 'Demande déjà traitée : le document n’est plus consultable.'
          : apiErrorMessage(body, 'Impossible d’afficher le document.'),
      );
      return;
    }
    setLoaded({ url: URL.createObjectURL(data), isPdf: data.type === 'application/pdf' });
  };

  if (loaded) {
    return loaded.isPdf ? (
      <Box component="iframe" title={label} src={loaded.url} w="100%" h={600} bd={0} />
    ) : (
      <Box component="img" alt={label} src={loaded.url} maw="100%" />
    );
  }
  return (
    <Stack gap="xs" align="flex-start">
      <Button variant="light" size="xs" loading={loading} onClick={() => void open()}>
        Afficher le document
      </Button>
      {error && <Alert color="orange">{error}</Alert>}
    </Stack>
  );
}
