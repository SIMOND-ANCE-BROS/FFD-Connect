import { BackToList } from '../components/BackToList';
import { PageHeader } from '../components/PageHeader';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
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
import { type RefObject, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { ListSkeleton } from '../components/ListStates';
import {
  trackCorrectionsControllerApprove,
  trackCorrectionsControllerReject,
  tracksControllerUpdate,
} from '../api/generated/sdk.gen';
import type { TrackCorrectionAdminDto } from '../api/generated/types.gen';
import {
  correctionQuery,
  ensureOk,
  moderationListQuery,
  pendingCountQuery,
  trackQuery,
  unwrap,
} from '../api/queries';
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
  isDeletionRequest,
  isPasoDoble,
  nextPendingFilter,
  REASON_LABELS,
  REJECT_TEMPLATES,
  type ReviewValues,
  STATUS_BADGES,
  trackAudioUrl,
} from '../lib/moderation';
import { formatParisDateTime } from '../lib/parisDate';

type Decision = 'approve' | 'reject';

type ComparedField = 'title' | 'artist' | 'style' | 'bpm' | 'clashTimecodes';

const FIELDS: { key: ComparedField; label: string }[] = [
  { key: 'title', label: 'Titre' },
  { key: 'artist', label: 'Artiste' },
  { key: 'style', label: 'Danse' },
  { key: 'bpm', label: 'MPM' },
  { key: 'clashTimecodes', label: 'Clashes paso' },
];

/**
 * Clashes are shown for a paso doble only: the track's dance or the proposed
 * one. A proposal that carries clashes (« Proposer les clashs » from the
 * player) keeps them visible whatever the dance, so it can still be decided.
 */
const hasClashes = (c: TrackCorrectionAdminDto): boolean =>
  isPasoDoble(c.track.style) || isPasoDoble(c.proposed.style) || c.proposed.clashTimecodes !== null;

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
  const [blacklistOpen, setBlacklistOpen] = useState(false);
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

  // « Blacklister le titre » (#561): acts on the related track through the
  // same admin route as the track page (audited, reversible there).
  const blacklist = useMutation({
    mutationFn: (trackId: string) =>
      ensureOk(tracksControllerUpdate({ path: { id: trackId }, body: { blacklisted: true } })),
    onSuccess: (_, trackId) => {
      void qc.invalidateQueries({ queryKey: correctionQuery(id).queryKey });
      void qc.invalidateQueries({ queryKey: trackQuery(trackId).queryKey });
      void qc.invalidateQueries({ queryKey: ['admin', 'tracks', 'list'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'moderation', 'list'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
      setBlacklistOpen(false);
      notifications.show({ color: 'green', message: 'Musique blacklistée' });
    },
  });
  const closeBlacklist = () => {
    if (!blacklist.isPending) setBlacklistOpen(false);
  };

  if (item.isError) {
    return <Alert color="red">{apiErrorMessage(item.error, 'Proposition introuvable.')}</Alert>;
  }
  if (!item.data) return <ListSkeleton rows={5} />;
  const c = item.data;
  const badge = STATUS_BADGES[c.status];
  const paso = hasClashes(c);

  return (
    <Stack>
      <Group gap="lg">
        <BackToList listPath="/moderation" search={search} />
        {/* The track the proposal is about (#562). */}
        <Anchor component={Link} to={`/tracks/${c.trackId}`}>
          Voir la fiche de la musique
        </Anchor>
      </Group>
      <Group justify="space-between">
        <Group>
          <PageHeader title={c.track.title} />
          {c.track.blacklisted && (
            <Badge color="red" variant="light">
              Retirée
            </Badge>
          )}
        </Group>
        <Group>
          {c.track.blacklisted ? (
            <Anchor component={Link} to={`/tracks/${c.trackId}`} size="sm">
              Fiche de la musique
            </Anchor>
          ) : (
            <Button
              variant="light"
              color="red"
              onClick={() => {
                blacklist.reset();
                setBlacklistOpen(true);
              }}
            >
              Blacklister le titre
            </Button>
          )}
          <Badge size="lg" variant="light" color={badge.color}>
            {badge.label}
          </Badge>
        </Group>
      </Group>
      <Modal
        opened={blacklistOpen}
        onClose={closeBlacklist}
        closeOnEscape={!blacklist.isPending}
        closeOnClickOutside={!blacklist.isPending}
        withCloseButton={!blacklist.isPending}
        title="Blacklister le titre"
      >
        <Stack>
          <Text size="sm">
            « {c.track.title} » sera retirée de la bibliothèque de l'app pour tous les utilisateurs.
            La proposition reste à traiter. Vous pourrez annuler depuis la fiche de la musique.
          </Text>
          {blacklist.isError && (
            <Alert color="red">
              {apiErrorMessage(blacklist.error, "Échec de l'enregistrement")}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" disabled={blacklist.isPending} onClick={closeBlacklist}>
              Annuler
            </Button>
            <Button
              color="red"
              loading={blacklist.isPending}
              onClick={() => !blacklist.isPending && blacklist.mutate(c.trackId)}
            >
              Blacklister
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Text c="dimmed">
        {c.track.artist} · {REASON_LABELS[c.reason]} · proposée par{' '}
        {c.proposer?.name ?? 'un compte supprimé'} le {formatParisDateTime(c.createdAt)}
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
            aria-label="Lecteur de la musique"
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
      {isDeletionRequest(c) ? (
        <Alert color="red" title="Proposition de suppression">
          L'auteur demande de retirer cette musique de la bibliothèque. Approuver la masque
          (blacklist) sans la supprimer définitivement, et refuse les autres propositions en attente
          sur cette musique. Refuser ne change rien.
        </Alert>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Champ</Table.Th>
              <Table.Th>Actuel</Table.Th>
              <Table.Th>Proposé</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {FIELDS.filter(({ key }) => paso || key !== 'clashTimecodes').map(({ key, label }) => (
              <Table.Tr key={key}>
                <Table.Td>{label}</Table.Td>
                <Table.Td>{show(c.track[key])}</Table.Td>
                <Table.Td>{show(c.proposed[key])}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
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
              {c.reviewedAt && ` le ${formatParisDateTime(c.reviewedAt)}`}
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
  // The admin may turn the dance into a paso doble here: the editor follows.
  const paso = hasClashes(c) || isPasoDoble(values.style);
  // A deletion request carries no value: approving it only hides the track.
  const deletion = isDeletionRequest(c);
  const overrides = deletion
    ? {}
    : approveOverrides(initial, paso ? values : { ...values, clashes: initial.clashes });
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
          {!deletion && (
            <>
              <Title order={2} size="h4">
                Valeurs à appliquer
              </Title>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
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
            </>
          )}
          {paso && !deletion && (
            <ClashEditor
              value={values.clashes}
              onChange={(v) => set('clashes', v)}
              audioRef={audioRef}
            />
          )}
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
            <Button color="red" variant="light" disabled={pending} onClick={() => open('reject')}>
              Refuser
            </Button>
            <Button
              color={deletion ? 'red' : 'green'}
              disabled={pending}
              onClick={() => open('approve')}
            >
              {deletion ? 'Approuver et retirer la musique' : 'Approuver'}
            </Button>
          </Group>
        </Stack>
      </Card>
      <Modal
        opened={confirm !== null}
        onClose={close}
        closeOnEscape={!pending}
        closeOnClickOutside={!pending}
        withCloseButton={!pending}
        title={confirm === 'approve' ? 'Confirmer la validation' : 'Confirmer le refus'}
      >
        <Stack>
          {confirm === 'approve' && deletion && (
            <Text size="sm">
              « {c.track.title} » sera retirée de la bibliothèque de l'app (blacklistée, pas
              supprimée). Les autres propositions en attente sur cette musique seront refusées.
            </Text>
          )}
          {confirm === 'approve' &&
            !deletion &&
            (Object.keys(preview.after).length > 0 ? (
              <ChangeSummary before={preview.before} after={preview.after} showClashes={paso} />
            ) : (
              <Text size="sm">La musique ne change pas.</Text>
            ))}
          {confirm === 'reject' && <Text size="sm">La musique ne sera pas modifiée.</Text>}
          {trimmed && <Text size="sm">Commentaire : {trimmed}</Text>}
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
