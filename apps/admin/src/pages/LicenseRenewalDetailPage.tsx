import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Radio,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import {
  adminLicenseRenewalsControllerApprove,
  adminLicenseRenewalsControllerReject,
} from '../api/generated/sdk.gen';
import type {
  AdminLicenseRenewalDetailDto,
  AdminRenewalOcrHintsDto,
} from '../api/generated/types.gen';
import { licenseRenewalQuery, pendingRenewalsCountQuery, unwrap } from '../api/queries';
import { RenewalDocumentViewer } from '../components/RenewalDocumentViewer';
import { apiErrorMessage, isConflict } from '../lib/apiError';
import { formatLicenseValidUntil } from '../lib/licenseDate';
import {
  COMMENT_MAX_LENGTH,
  DOCUMENT_LABELS,
  initialLicenseNumber,
  isLicenseNumberTaken,
  REJECTION_REASON_LABELS,
  REJECTION_REASONS,
  type RejectionReason,
  STATUS_BADGES,
} from '../lib/licenseRenewals';

type Decision = 'approve' | 'reject';

const day = (iso: string | null) => (iso ? dayjs(iso).format('DD/MM/YYYY') : '—');
const dateTime = (iso: string | null) => (iso ? dayjs(iso).format('DD/MM/YYYY HH:mm') : '—');

/** OCR readings, shown as hints to check against the document (#19), never as a verdict. */
function OcrHints({ ocr }: { ocr: AdminRenewalOcrHintsDto }) {
  const lines: string[] = [];
  if (ocr.isApte !== undefined) lines.push(`Aptitude lue : ${ocr.isApte ? 'oui' : 'non'}`);
  if (ocr.date) lines.push(`Date lue : ${ocr.date}`);
  if (ocr.doctorName) lines.push(`Médecin lu : ${ocr.doctorName}`);
  if (ocr.licenseNumber) lines.push(`Numéro lu : ${ocr.licenseNumber}`);
  if (ocr.expiryDate) lines.push(`Expiration lue : ${ocr.expiryDate}`);
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed">
        Indices lus automatiquement, à vérifier sur le document
      </Text>
      {lines.length === 0 ? (
        <Text size="sm">Rien n’a pu être lu</Text>
      ) : (
        lines.map((line) => (
          <Text key={line} size="sm">
            {line}
          </Text>
        ))
      )}
    </Stack>
  );
}

export function LicenseRenewalDetailPage() {
  const { id = '' } = useParams();
  const { search } = useLocation();
  const qc = useQueryClient();
  const [conflict, setConflict] = useState<string | null>(null);
  const item = useQuery(licenseRenewalQuery(id));

  const refreshAfterDecision = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'license-renewals', 'list'] });
    void qc.invalidateQueries({ queryKey: pendingRenewalsCountQuery.queryKey });
    void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };

  if (item.isError) {
    return <Alert color="red">{apiErrorMessage(item.error, 'Demande introuvable.')}</Alert>;
  }
  if (!item.data) return <Loader />;
  const r = item.data;
  const pending = r.status === 'PENDING';
  const badge = STATUS_BADGES[r.status];

  return (
    <Stack>
      <Anchor component={Link} to={`/license-renewals${search}`}>
        Retour à la liste
      </Anchor>
      <Group justify="space-between">
        <Title order={2}>
          {r.user.firstName} {r.user.lastName}
        </Title>
        <Badge size="lg" variant="light" color={badge.color}>
          {badge.label}
        </Badge>
      </Group>
      <Group gap="md">
        <Anchor component={Link} to={`/users/${r.user.id}`}>
          Voir la fiche
        </Anchor>
        <Text size="sm" c="dimmed">
          Soumise le {dateTime(r.submittedAt)}
        </Text>
      </Group>
      {conflict && <Alert color="orange">{conflict}</Alert>}
      <Card withBorder>
        <Stack gap={4}>
          <Title order={4}>Licence actuelle</Title>
          <Text size="sm">Numéro : {r.user.license?.number ?? '—'}</Text>
          <Text size="sm">
            Fin de validité :{' '}
            {r.user.license ? formatLicenseValidUntil(r.user.license.validUntil) : '—'}
          </Text>
        </Stack>
      </Card>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        {r.documents.map((d) => (
          <Card key={d.id} withBorder>
            <Stack gap="xs">
              <Title order={5}>{DOCUMENT_LABELS[d.type]}</Title>
              <Text size="xs" c="dimmed">
                Déposé le {dateTime(d.createdAt)}
              </Text>
              {d.ocr && <OcrHints ocr={d.ocr} />}
              {pending && <RenewalDocumentViewer requestId={r.id} document={d} />}
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
      {pending ? (
        <DecisionForm
          key={r.id}
          r={r}
          onDecided={(updated) => {
            setConflict(null);
            qc.setQueryData(licenseRenewalQuery(id).queryKey, updated);
            refreshAfterDecision();
          }}
          onConflict={(message) => {
            setConflict(message);
            refreshAfterDecision();
            void qc.invalidateQueries({ queryKey: licenseRenewalQuery(id).queryKey });
          }}
        />
      ) : (
        <Card withBorder>
          <Stack gap={4}>
            <Text size="sm">
              {`${badge.label} par ${
                r.reviewedBy
                  ? `${r.reviewedBy.firstName} ${r.reviewedBy.lastName}`
                  : 'la validation automatique'
              } le ${dateTime(r.reviewedAt)}`}
            </Text>
            {r.rejectionReason && (
              <Text size="sm">{`Motif : ${REJECTION_REASON_LABELS[r.rejectionReason]}`}</Text>
            )}
            {r.reviewComment && <Text size="sm">{`Commentaire : ${r.reviewComment}`}</Text>}
          </Stack>
        </Card>
      )}
      {r.history.length > 0 && (
        <Card withBorder>
          <Stack gap={4}>
            <Title order={4}>Demandes précédentes</Title>
            {r.history.map((h) => (
              <Text key={h.id} size="sm">
                {`${STATUS_BADGES[h.status].label} · soumise le ${day(h.submittedAt)}`}
                {h.reviewedAt ? ` · traitée le ${day(h.reviewedAt)}` : ''}
              </Text>
            ))}
          </Stack>
        </Card>
      )}
    </Stack>
  );
}

interface DecisionFormProps {
  r: AdminLicenseRenewalDetailDto;
  onDecided: (updated: AdminLicenseRenewalDetailDto) => void;
  onConflict: (message: string) => void;
}

function DecisionForm({ r, onDecided, onConflict }: DecisionFormProps) {
  const [licenseNumber, setLicenseNumber] = useState(() =>
    initialLicenseNumber(r.documents, r.user.license),
  );
  const [reason, setReason] = useState<RejectionReason | null>(null);
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState<Decision | null>(null);
  const number = licenseNumber.trim();
  const current = r.user.license?.number ?? null;
  // Sent only when it changes the licence: omitted, the API keeps the current
  // number (or uses the OCR reading for a new licence).
  const changesNumber = number !== '' && number !== current;
  const trimmedComment = comment.trim();

  const decide = useMutation({
    mutationFn: (decision: Decision) =>
      decision === 'approve'
        ? unwrap(
            adminLicenseRenewalsControllerApprove({
              path: { id: r.id },
              body: changesNumber ? { licenseNumber: number } : {},
            }),
          )
        : unwrap(
            adminLicenseRenewalsControllerReject({
              path: { id: r.id },
              body: {
                reason: reason as RejectionReason,
                ...(trimmedComment && { comment: trimmedComment }),
              },
            }),
          ),
    onSuccess: (updated, decision) => {
      setConfirm(null);
      notifications.show({
        color: 'green',
        message: decision === 'approve' ? 'Renouvellement approuvé' : 'Demande refusée',
      });
      onDecided(updated);
    },
    onError: (e) => {
      // A number taken by another account: the admin corrects it in place.
      if (isLicenseNumberTaken(e)) return;
      if (isConflict(e)) {
        setConfirm(null);
        onConflict(apiErrorMessage(e, 'Déjà traitée'));
      }
    },
  });
  // A decision in flight (up to 2 min on a cold start) locks the form and the modal.
  const pending = decide.isPending;
  const open = (decision: Decision) => {
    if (pending) return;
    decide.reset();
    setConfirm(decision);
  };
  const close = () => {
    if (!pending) setConfirm(null);
  };

  return (
    <>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder>
          <Stack>
            <Title order={4}>Approuver</Title>
            <TextInput
              label="Numéro de licence"
              description="Prérempli depuis l’attestation ou la licence actuelle : vérifiez-le."
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button color="green" disabled={pending || !number} onClick={() => open('approve')}>
                Approuver
              </Button>
            </Group>
          </Stack>
        </Card>
        <Card withBorder>
          <Stack>
            <Title order={4}>Refuser</Title>
            <Radio.Group
              label="Motif"
              value={reason}
              onChange={(v) => setReason(v as RejectionReason)}
            >
              <Stack gap={4} mt="xs">
                {REJECTION_REASONS.map((code) => (
                  <Radio key={code} value={code} label={REJECTION_REASON_LABELS[code]} />
                ))}
              </Stack>
            </Radio.Group>
            <Textarea
              label="Commentaire au licencié (facultatif)"
              autosize
              minRows={2}
              maxLength={COMMENT_MAX_LENGTH}
              value={comment}
              onChange={(e) => setComment(e.currentTarget.value)}
            />
            <Alert color="yellow" p="xs">
              Ne saisissez aucun détail médical : le motif et le commentaire sont transmis au
              licencié.
            </Alert>
            <Group justify="flex-end">
              <Button
                color="red"
                variant="light"
                disabled={pending || !reason}
                onClick={() => open('reject')}
              >
                Refuser
              </Button>
            </Group>
          </Stack>
        </Card>
      </SimpleGrid>
      <Modal
        opened={confirm !== null}
        onClose={close}
        closeOnEscape={!pending}
        closeOnClickOutside={!pending}
        withCloseButton={!pending}
        title={confirm === 'approve' ? 'Confirmer l’approbation' : 'Confirmer le refus'}
      >
        <Stack>
          {confirm === 'approve' && (
            <Text size="sm">
              {`La licence n° ${number} sera renouvelée jusqu’au ${
                r.renewsUntil ? formatLicenseValidUntil(r.renewsUntil) : '—'
              }.`}
            </Text>
          )}
          {confirm === 'approve' && current && changesNumber && (
            <Text size="sm" fw={500}>{`Le numéro passera de ${current} à ${number}.`}</Text>
          )}
          {confirm === 'reject' && reason && (
            <Stack gap={4}>
              <Text size="sm">{`Motif : ${REJECTION_REASON_LABELS[reason]}`}</Text>
              {trimmedComment && <Text size="sm">{`Commentaire : ${trimmedComment}`}</Text>}
            </Stack>
          )}
          {decide.isError && (!isConflict(decide.error) || isLicenseNumberTaken(decide.error)) && (
            <Alert color="red">{apiErrorMessage(decide.error, 'Décision impossible.')}</Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" disabled={pending} onClick={close}>
              Annuler
            </Button>
            <Button loading={pending} onClick={() => confirm && !pending && decide.mutate(confirm)}>
              Confirmer
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
