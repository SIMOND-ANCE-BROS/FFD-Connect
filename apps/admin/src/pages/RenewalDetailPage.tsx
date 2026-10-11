import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Table,
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
import type { AdminLicenseRenewalDetailDto } from '../api/generated/types.gen';
import { renewalQuery, renewalsPendingCountQuery, unwrap } from '../api/queries';
import { RenewalDocumentViewer } from '../components/RenewalDocumentViewer';
import { apiErrorMessage, isConflict } from '../lib/apiError';
import {
  fullName,
  LICENSE_NUMBER_MAX_LENGTH,
  NO_MEDICAL_DETAIL_WARNING,
  prefilledLicenseNumber,
  REJECTION_REASON_LABELS,
  REJECTION_REASONS,
  type RenewalRejectionReason,
  RENEWAL_STATUS_BADGES,
  reviewerLabel,
  REVIEW_COMMENT_MAX_LENGTH,
} from '../lib/renewals';

type Decision = 'approve' | 'reject';

const CONFLICT_FALLBACK = 'Cette demande de renouvellement a déjà été traitée.';

const formatDate = (value: string | null): string =>
  value ? dayjs(value).format('DD/MM/YYYY HH:mm') : '—';
const formatDay = (value: string): string => dayjs(value).format('DD/MM/YYYY');

export function RenewalDetailPage() {
  const { id = '' } = useParams();
  // Another request starts from a fresh form, documents hidden.
  return <RenewalReview key={id} id={id} />;
}

function RenewalReview({ id }: { id: string }) {
  const { search } = useLocation();
  const qc = useQueryClient();
  const [conflict, setConflict] = useState<string | null>(null);
  const item = useQuery(renewalQuery(id));

  const refreshAfterDecision = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'renewals', 'list'] });
    void qc.invalidateQueries({ queryKey: renewalsPendingCountQuery.queryKey });
    void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };

  if (item.isError) {
    return <Alert color="red">{apiErrorMessage(item.error, 'Demande introuvable.')}</Alert>;
  }
  if (!item.data) return <Loader />;
  const r = item.data;
  const badge = RENEWAL_STATUS_BADGES[r.status];
  const isPending = r.status === 'PENDING';

  return (
    <Stack>
      <Anchor component={Link} to={`/license-renewals${search}`}>
        Retour à la liste
      </Anchor>
      <Group justify="space-between">
        <Title order={2}>{fullName(r.user)}</Title>
        <Badge size="lg" variant="light" color={badge.color}>
          {badge.label}
        </Badge>
      </Group>
      <Text c="dimmed">
        Demande soumise le {formatDate(r.submittedAt)} ·{' '}
        <Anchor component={Link} to={`/users/${r.user.id}`} size="sm">
          Voir la fiche
        </Anchor>
      </Text>
      {conflict && (
        <Alert color="orange" title="Décision non enregistrée">
          {conflict} L'état de la demande a été rechargé.
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Card withBorder>
          <Text size="sm" fw={500}>
            Licence actuelle
          </Text>
          <Text size="sm">
            {r.user.license
              ? `${r.user.license.number}, valable jusqu'au ${formatDay(r.user.license.validUntil)}`
              : 'Aucune licence'}
          </Text>
        </Card>
        {r.renewsUntil && (
          <Card withBorder>
            <Text size="sm" fw={500}>
              En cas d'approbation
            </Text>
            <Text size="sm">Licence valable jusqu'au {formatDay(r.renewsUntil)}</Text>
          </Card>
        )}
      </SimpleGrid>
      <Title order={4}>Documents</Title>
      {r.documents.length === 0 && <Text size="sm">Aucun document.</Text>}
      {isPending ? (
        r.documents.map((doc) => <RenewalDocumentViewer key={doc.id} renewalId={r.id} doc={doc} />)
      ) : r.documents.length > 0 ? (
        <Text size="sm" c="dimmed">
          La demande a été traitée : ses documents ne sont plus consultables.
        </Text>
      ) : null}
      {isPending ? (
        <DecisionForm
          renewal={r}
          onDecided={(updated) => {
            setConflict(null);
            qc.setQueryData(renewalQuery(id).queryKey, updated);
            refreshAfterDecision();
          }}
          onConflict={(message) => {
            setConflict(message);
            refreshAfterDecision();
            void qc.invalidateQueries({ queryKey: renewalQuery(id).queryKey });
          }}
        />
      ) : (
        <Card withBorder>
          <Stack gap={4}>
            <Text size="sm">
              Traitée par {reviewerLabel(r)}
              {r.reviewedAt && ` le ${formatDate(r.reviewedAt)}`}
            </Text>
            {r.status === 'REJECTED' && (
              <>
                <Text size="sm">
                  Motif : {r.rejectionReason ? REJECTION_REASON_LABELS[r.rejectionReason] : '—'}
                </Text>
                <Text size="sm">Commentaire : {r.reviewComment ?? '—'}</Text>
              </>
            )}
          </Stack>
        </Card>
      )}
      <History renewal={r} />
    </Stack>
  );
}

function History({ renewal }: { renewal: AdminLicenseRenewalDetailDto }) {
  if (renewal.history.length === 0) return null;
  return (
    <>
      <Title order={4}>Demandes précédentes</Title>
      <Table aria-label="Demandes précédentes">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Statut</Table.Th>
            <Table.Th>Soumise le</Table.Th>
            <Table.Th>Traitée le</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {renewal.history.map((h) => (
            <Table.Tr key={h.id}>
              <Table.Td>
                <Anchor component={Link} to={`/license-renewals/${h.id}`} size="sm">
                  {RENEWAL_STATUS_BADGES[h.status].label}
                </Anchor>
              </Table.Td>
              <Table.Td>{formatDate(h.submittedAt)}</Table.Td>
              <Table.Td>{formatDate(h.reviewedAt)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </>
  );
}

interface DecisionFormProps {
  renewal: AdminLicenseRenewalDetailDto;
  onDecided: (updated: AdminLicenseRenewalDetailDto) => void;
  onConflict: (message: string) => void;
}

function DecisionForm({ renewal, onDecided, onConflict }: DecisionFormProps) {
  const [licenseNumber, setLicenseNumber] = useState(() => prefilledLicenseNumber(renewal));
  const [reason, setReason] = useState<RenewalRejectionReason | null>(null);
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState<Decision | null>(null);
  const number = licenseNumber.trim();
  const trimmed = comment.trim();
  const name = fullName(renewal.user);

  const decide = useMutation({
    mutationFn: (decision: Decision) => {
      if (decision === 'approve') {
        return unwrap(
          adminLicenseRenewalsControllerApprove({
            path: { id: renewal.id },
            body: { licenseNumber: number },
          }),
        );
      }
      // The button is disabled without a reason; the API refuses one anyway.
      if (!reason) return Promise.reject(new Error('Choisissez un motif de refus.'));
      return unwrap(
        adminLicenseRenewalsControllerReject({
          path: { id: renewal.id },
          body: { reason, ...(trimmed && { comment: trimmed }) },
        }),
      );
    },
    onSuccess: (updated, decision) => {
      setConfirm(null);
      notifications.show({
        color: 'green',
        message: decision === 'approve' ? 'Renouvellement approuvé' : 'Renouvellement refusé',
      });
      onDecided(updated);
    },
    onError: (e) => {
      if (isConflict(e)) {
        setConfirm(null);
        onConflict(apiErrorMessage(e, CONFLICT_FALLBACK));
      }
    },
  });

  // A decision in flight (up to 2 min on a cold start) locks the form and the
  // modal: no second request, whatever the admin clicks.
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
              description="Prérempli à partir de la lecture automatique ou de la licence actuelle : vérifiez-le sur l'attestation."
              required
              maxLength={LICENSE_NUMBER_MAX_LENGTH}
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
            <Select
              label="Motif du refus"
              placeholder="Choisir un motif"
              required
              data={REJECTION_REASONS.map((value) => ({
                value,
                label: REJECTION_REASON_LABELS[value],
              }))}
              value={reason}
              onChange={(v) => setReason(v as RenewalRejectionReason | null)}
            />
            <Alert color="orange">{NO_MEDICAL_DETAIL_WARNING}</Alert>
            <Textarea
              label="Commentaire (facultatif, transmis au licencié)"
              autosize
              minRows={2}
              maxLength={REVIEW_COMMENT_MAX_LENGTH}
              value={comment}
              onChange={(e) => setComment(e.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button
                color="red"
                variant="light"
                disabled={pending || reason === null}
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
        title={confirm === 'approve' ? "Confirmer l'approbation" : 'Confirmer le refus'}
      >
        <Stack>
          {confirm === 'approve' && (
            <>
              <Text size="sm">
                La licence de {name} sera renouvelée avec le numéro <strong>{number}</strong>
                {renewal.renewsUntil && `, jusqu'au ${formatDay(renewal.renewsUntil)}`}.
              </Text>
              <Text size="sm">Vérifiez que ce numéro est celui de l'attestation.</Text>
            </>
          )}
          {confirm === 'reject' && reason && (
            <>
              <Text size="sm">La demande de {name} sera refusée.</Text>
              <Text size="sm">Motif : {REJECTION_REASON_LABELS[reason]}</Text>
              {trimmed && <Text size="sm">Commentaire : {trimmed}</Text>}
            </>
          )}
          {decide.isError && !isConflict(decide.error) && (
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
