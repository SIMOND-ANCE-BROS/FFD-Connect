import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  NumberInput,
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
import { type RefObject, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  trackCorrectionsControllerApprove,
  trackCorrectionsControllerReject,
} from '../api/generated/sdk.gen';
import type { TrackCorrectionAdminDto } from '../api/generated/types.gen';
import { correctionQuery, moderationListQuery, pendingCountQuery, unwrap } from '../api/queries';
import { ChangeSummary } from '../components/ChangeSummary';
import { ClashEditor } from '../components/ClashEditor';
import { apiErrorMessage, isConflict } from '../lib/apiError';
import {
  APPROVE_TEMPLATES,
  approvalPreview,
  approveOverrides,
  formatTimecode,
  initialReviewValues,
  insertTemplate,
  nextPendingFilter,
  REASON_LABELS,
  REJECT_TEMPLATES,
  type ReviewValues,
  STATUS_BADGES,
  trackAudioUrl,
} from '../lib/moderation';

type Decision = 'approve' | 'reject';

type ComparedField = 'title' | 'artist' | 'style' | 'bpm' | 'clashTimecodes';

const FIELDS: { key: ComparedField; label: string }[] = [
  { key: 'title', label: 'Titre' },
  { key: 'artist', label: 'Artiste' },
  { key: 'style', label: 'Danse' },
  { key: 'bpm', label: 'MPM' },
  { key: 'clashTimecodes', label: 'Clashes paso' },
];

function show(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) {
    return value.length ? value.map((v) => formatTimecode(Number(v))).join(', ') : 'Aucun clash';
  }
  return String(value);
}

export function ModerationDetailPage() {
  const { id = '' } = useParams();
  // A new id (« Proposition suivante ») starts from a fresh form.
  return <CorrectionReview key={id} id={id} />;
}

function CorrectionReview({ id }: { id: string }) {
  const { search } = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [position, setPosition] = useState(0);
  const [decided, setDecided] = useState(false);
  const [conflict, setConflict] = useState(false);
  const item = useQuery(correctionQuery(id));

  const refreshAfterDecision = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'moderation', 'list'] });
    void qc.invalidateQueries({ queryKey: pendingCountQuery.queryKey });
    void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };

  const next = useMutation({
    mutationFn: async () => {
      const page = await qc.fetchQuery(moderationListQuery(nextPendingFilter(params)));
      return page.data[0]?.id ?? null;
    },
    onSuccess: (nextId) =>
      navigate(nextId ? `/moderation/${nextId}${search}` : `/moderation${search}`),
    onError: (e) =>
      notifications.show({
        color: 'red',
        message: apiErrorMessage(e, 'Impossible de charger la proposition suivante.'),
      }),
  });

  if (item.isError) {
    return <Alert color="red">{apiErrorMessage(item.error, 'Proposition introuvable.')}</Alert>;
  }
  if (!item.data) return <Loader />;
  const c = item.data;
  const badge = STATUS_BADGES[c.status];

  return (
    <Stack>
      <Anchor component={Link} to={`/moderation${search}`}>
        Retour à la liste
      </Anchor>
      <Group justify="space-between">
        <Group>
          <Title order={2}>{c.track.title}</Title>
          {c.track.titleMasked && (
            <Badge color="gray" variant="light">
              Titre masqué
            </Badge>
          )}
          {c.track.blacklisted && (
            <Badge color="red" variant="light">
              Retirée
            </Badge>
          )}
        </Group>
        <Badge size="lg" variant="light" color={badge.color}>
          {badge.label}
        </Badge>
      </Group>
      <Text c="dimmed">
        {c.track.artist} · {REASON_LABELS[c.reason]} · proposée par{' '}
        {c.proposer?.name ?? 'un compte supprimé'} le{' '}
        {dayjs(c.createdAt).format('DD/MM/YYYY HH:mm')}
      </Text>
      {conflict && <Alert color="orange">Déjà traitée</Alert>}
      {(decided || conflict) && (
        <Group>
          <Button loading={next.isPending} onClick={() => next.mutate()}>
            Proposition suivante
          </Button>
        </Group>
      )}
      <Card withBorder>
        <Stack gap="xs">
          <audio
            ref={audioRef}
            controls
            preload="metadata"
            // CORS load: helmet's Cross-Origin-Resource-Policy: same-origin
            // blocks a no-cors media load from the back-office origin.
            crossOrigin="anonymous"
            src={trackAudioUrl(c.track.filename)}
            onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
            style={{ width: '100%' }}
          />
          <Text size="sm" c="dimmed">
            Position : {formatTimecode(position)}
          </Text>
        </Stack>
      </Card>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Champ</Table.Th>
            <Table.Th>Actuel</Table.Th>
            <Table.Th>Proposé</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {FIELDS.map(({ key, label }) => (
            <Table.Tr key={key}>
              <Table.Td>{label}</Table.Td>
              <Table.Td>{show(c.track[key])}</Table.Td>
              <Table.Td>{show(c.proposed[key])}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Card withBorder>
        <Text size="sm" fw={500}>
          Message de l'auteur
        </Text>
        <Text size="sm">{c.message ?? '—'}</Text>
      </Card>
      {c.status === 'PENDING' ? (
        <DecisionForm
          c={c}
          audioRef={audioRef}
          onDecided={(updated) => {
            qc.setQueryData(correctionQuery(id).queryKey, updated);
            refreshAfterDecision();
            setDecided(true);
          }}
          onConflict={() => {
            setConflict(true);
            refreshAfterDecision();
            void qc.invalidateQueries({ queryKey: correctionQuery(id).queryKey });
          }}
        />
      ) : (
        <Card withBorder>
          <Stack gap={4}>
            <Text size="sm">
              Traitée par {c.reviewer?.name ?? 'un admin supprimé'}
              {c.reviewedAt && ` le ${dayjs(c.reviewedAt).format('DD/MM/YYYY HH:mm')}`}
            </Text>
            <Text size="sm">Commentaire : {c.reviewComment ?? '—'}</Text>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}

interface DecisionFormProps {
  c: TrackCorrectionAdminDto;
  audioRef: RefObject<HTMLAudioElement | null>;
  onDecided: (updated: TrackCorrectionAdminDto) => void;
  onConflict: () => void;
}

function DecisionForm({ c, audioRef, onDecided, onConflict }: DecisionFormProps) {
  const [initial] = useState<ReviewValues>(() => initialReviewValues(c));
  const [values, setValues] = useState<ReviewValues>(initial);
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState<Decision | null>(null);
  const overrides = approveOverrides(initial, values);
  const preview = approvalPreview(c, overrides);
  const trimmed = comment.trim();

  const decide = useMutation({
    mutationFn: (decision: Decision) =>
      decision === 'approve'
        ? unwrap(
            trackCorrectionsControllerApprove({
              path: { id: c.id },
              body: { ...overrides, ...(trimmed && { comment: trimmed }) },
            }),
          )
        : unwrap(
            trackCorrectionsControllerReject({
              path: { id: c.id },
              body: trimmed ? { comment: trimmed } : {},
            }),
          ),
    onSuccess: (updated, decision) => {
      setConfirm(null);
      notifications.show({
        color: 'green',
        message: decision === 'approve' ? 'Proposition approuvée' : 'Proposition refusée',
      });
      onDecided(updated);
    },
    onError: (e) => {
      if (isConflict(e)) {
        setConfirm(null);
        onConflict();
      }
    },
  });

  const set = <K extends keyof ReviewValues>(key: K, value: ReviewValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));
  const open = (decision: Decision) => {
    decide.reset();
    setConfirm(decision);
  };
  const template = (text: string) => (
    <Button
      key={text}
      size="xs"
      variant="light"
      onClick={() => setComment((prev) => insertTemplate(prev, text))}
    >
      {text}
    </Button>
  );

  return (
    <>
      <Card withBorder>
        <Stack>
          <Title order={4}>Valeurs à appliquer</Title>
          <SimpleGrid cols={2}>
            <TextInput
              label="Titre"
              value={values.title}
              onChange={(e) => set('title', e.currentTarget.value)}
            />
            <TextInput
              label="Artiste"
              value={values.artist}
              onChange={(e) => set('artist', e.currentTarget.value)}
            />
            <TextInput
              label="Danse"
              value={values.style}
              onChange={(e) => set('style', e.currentTarget.value)}
            />
            <NumberInput
              label="MPM"
              min={1}
              max={400}
              decimalScale={1}
              value={values.bpm}
              onChange={(v) => set('bpm', v)}
            />
          </SimpleGrid>
          <ClashEditor
            value={values.clashes}
            onChange={(v) => set('clashes', v)}
            audioRef={audioRef}
          />
          <Textarea
            label="Commentaire (transmis à l'auteur)"
            autosize
            minRows={2}
            maxLength={500}
            value={comment}
            onChange={(e) => setComment(e.currentTarget.value)}
          />
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              Refus :
            </Text>
            {REJECT_TEMPLATES.map(template)}
            <Text size="sm" c="dimmed">
              Validation :
            </Text>
            {APPROVE_TEMPLATES.map(template)}
          </Group>
          <Group justify="flex-end">
            <Button color="red" variant="light" onClick={() => open('reject')}>
              Refuser
            </Button>
            <Button color="green" onClick={() => open('approve')}>
              Approuver
            </Button>
          </Group>
        </Stack>
      </Card>
      <Modal
        opened={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'approve' ? 'Confirmer la validation' : 'Confirmer le refus'}
      >
        <Stack>
          {confirm === 'approve' &&
            (Object.keys(preview.after).length > 0 ? (
              <ChangeSummary before={preview.before} after={preview.after} />
            ) : (
              <Text size="sm">La musique ne change pas.</Text>
            ))}
          {confirm === 'reject' && <Text size="sm">La musique ne sera pas modifiée.</Text>}
          {trimmed && <Text size="sm">Commentaire : {trimmed}</Text>}
          {decide.isError && !isConflict(decide.error) && (
            <Alert color="red">{apiErrorMessage(decide.error, 'Décision impossible.')}</Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(null)}>
              Annuler
            </Button>
            <Button loading={decide.isPending} onClick={() => confirm && decide.mutate(confirm)}>
              Confirmer
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
