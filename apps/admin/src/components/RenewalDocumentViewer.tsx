import { Alert, Button, Card, Group, Stack, Table, Text } from '@mantine/core';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { adminLicenseRenewalsControllerDocumentFile } from '../api/generated/sdk.gen';
import type { AdminRenewalDocumentDetailDto } from '../api/generated/types.gen';
import { apiErrorMessage } from '../lib/apiError';
import { DOCUMENT_TYPE_LABELS, documentViewer, ocrHints } from '../lib/renewals';

interface ShownFile {
  url: string;
  viewer: 'image' | 'pdf';
}

interface Props {
  renewalId: string;
  doc: AdminRenewalDocumentDetailDto;
}

/**
 * One document of a pending renewal: its OCR hints, and its file only on
 * click. The file (health data) is fetched through the authenticated client,
 * never cached, held as an object URL that is revoked when hidden or when the
 * component unmounts (leaving the page, a decision).
 */
export function RenewalDocumentViewer({ renewalId, doc }: Props) {
  const [file, setFile] = useState<ShownFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const urlRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const label = DOCUMENT_TYPE_LABELS[doc.type];
  const hints = ocrHints(doc.ocr);

  const revoke = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revoke();
    };
  }, []);

  const show = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    const { data, error: failure } = await adminLicenseRenewalsControllerDocumentFile({
      path: { id: renewalId, docId: doc.id },
      parseAs: 'blob',
      cache: 'no-store',
    });
    // Left the page meanwhile: nothing to show, no URL to leak.
    if (!mounted.current) return;
    setLoading(false);
    if (failure !== undefined || !(data instanceof Blob)) {
      setError(apiErrorMessage(failure, "Impossible d'afficher le document."));
      return;
    }
    const viewer = documentViewer(data.type);
    if (!viewer) {
      setError("Format de document non pris en charge : il n'est pas affiché.");
      return;
    }
    revoke();
    urlRef.current = URL.createObjectURL(data);
    setFile({ url: urlRef.current, viewer });
  };

  const hide = () => {
    revoke();
    setFile(null);
  };

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={500}>{label}</Text>
          <Text size="sm" c="dimmed">
            Envoyé le {dayjs(doc.createdAt).format('DD/MM/YYYY HH:mm')}
          </Text>
        </Group>
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Indices de lecture automatique
          </Text>
          <Text size="xs" c="dimmed">
            Lus par l'OCR, sans valeur de décision : vérifiez-les sur le document.
          </Text>
          {hints.length === 0 ? (
            <Text size="sm">Aucun indice lu.</Text>
          ) : (
            <Table aria-label={`Indices OCR — ${label}`}>
              <Table.Tbody>
                {hints.map((h) => (
                  <Table.Tr key={h.label}>
                    <Table.Td>{h.label}</Table.Td>
                    <Table.Td>{h.value}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
        <Group>
          {file ? (
            <Button variant="default" onClick={hide}>
              Masquer le document
            </Button>
          ) : (
            <Button variant="light" loading={loading} onClick={() => void show()}>
              Afficher le document
            </Button>
          )}
        </Group>
        {error && <Alert color="red">{error}</Alert>}
        {file?.viewer === 'image' && (
          <img src={file.url} alt={label} style={{ maxWidth: '100%', height: 'auto' }} />
        )}
        {file?.viewer === 'pdf' && (
          <iframe title={label} src={file.url} style={{ width: '100%', height: 600, border: 0 }} />
        )}
      </Stack>
    </Card>
  );
}
