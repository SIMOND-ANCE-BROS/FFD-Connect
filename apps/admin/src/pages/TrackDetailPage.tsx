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
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { tracksControllerRemove, tracksControllerUpdate } from '../api/generated/sdk.gen';
import type { UpdateTrackDto } from '../api/generated/types.gen';
import { auditQuery, ensureOk, trackQuery } from '../api/queries';
import { ChangeSummary } from '../components/ChangeSummary';
import { ClashEditor } from '../components/ClashEditor';
import { apiErrorMessage, isConflict } from '../lib/apiError';
import { ACTION_LABELS } from '../lib/auditLabels';
import { withLegacy } from '../lib/diff';
import { formatTimecode, trackAudioUrl } from '../lib/moderation';
import {
  initialEditValues,
  resultingBpm,
  STYLE_OPTIONS,
  titleConfirms,
  trackArtworkUrl,
  trackChangePreview,
  type TrackEditValues,
  trackPatch,
  type TrackPatch,
  TRACK_STATUS_BADGES,
} from '../lib/tracks';

type Toggle = 'titleMasked' | 'blacklisted';

interface ToggleCopy {
  title: string;
  text: string;
  confirm: string;
}

const TOGGLE_COPY: Record<Toggle, { on: ToggleCopy; off: ToggleCopy }> = {
  titleMasked: {
    on: {
      title: 'Masquer le titre',
      text: "Les utilisateurs de l'app verront « Titre masqué » à la place du titre. Les admins voient toujours le vrai titre.",
      confirm: 'Masquer',
    },
    off: {
      title: 'Afficher le titre',
      text: "Le vrai titre sera de nouveau visible dans l'app.",
      confirm: 'Afficher',
    },
  },
  blacklisted: {
    on: {
      title: 'Blacklister la musique',
      text: "La musique sera retirée de la bibliothèque de l'app pour tous les utilisateurs.",
      confirm: 'Blacklister',
    },
    off: {
      title: 'Retirer de la blacklist',
      text: "La musique reviendra dans la bibliothèque de l'app si elle est prête.",
      confirm: 'Retirer de la blacklist',
    },
  },
};

const toggleBody = (key: Toggle, value: boolean): UpdateTrackDto =>
  key === 'titleMasked' ? { titleMasked: value } : { blacklisted: value };

export function TrackDetailPage() {
  const { id = '' } = useParams();
  // Another track starts from a fresh form.
  return <TrackEditor key={id} id={id} />;
}

function TrackEditor({ id }: { id: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [position, setPosition] = useState(0);
  const track = useQuery(trackQuery(id));
  const history = useQuery({
    ...auditQuery({ targetType: 'TRACK', targetId: id, skip: 0, take: 20 }),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const [values, setValues] = useState<TrackEditValues | null>(null);
  const [bpmTouched, setBpmTouched] = useState(false);
  const [pending, setPending] = useState<TrackPatch | null>(null);
  const [toggle, setToggle] = useState<{ key: Toggle; value: boolean } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typedTitle, setTypedTitle] = useState('');

  // The form starts from the server on the first load and after the admin's
  // own form save only: a switch save or a refused deletion refetches the
  // track too, and must not wipe unsaved edits (trackPatch diffs them against
  // the fresh track, and the switch fields are not part of the form).
  const resync = useRef(true);
  useEffect(() => {
    if (track.data && resync.current) {
      resync.current = false;
      setValues(initialEditValues(track.data));
      setBpmTouched(false);
    }
  }, [track.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trackQuery(id).queryKey });
    void qc.invalidateQueries({ queryKey: ['admin', 'tracks', 'list'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };

  const save = useMutation({
    mutationFn: (body: UpdateTrackDto) => ensureOk(tracksControllerUpdate({ path: { id }, body })),
    onSuccess: (_, body) => {
      if (!('titleMasked' in body) && !('blacklisted' in body)) resync.current = true;
      refresh();
      setPending(null);
      setToggle(null);
      notifications.show({ color: 'green', message: 'Musique mise à jour' });
    },
  });

  const remove = useMutation({
    mutationFn: () => ensureOk(tracksControllerRemove({ path: { id } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'tracks', 'list'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
      notifications.show({ color: 'green', message: 'Musique supprimée' });
      navigate('/tracks', { replace: true });
      qc.removeQueries({ queryKey: trackQuery(id).queryKey });
    },
    // A 409 means proposals arrived since the page loaded: refresh the count.
    onError: (e) => {
      if (isConflict(e)) void qc.invalidateQueries({ queryKey: trackQuery(id).queryKey });
    },
  });

  if (track.isError) {
    return <Alert color="red">{apiErrorMessage(track.error, 'Musique introuvable.')}</Alert>;
  }
  if (!track.data || !values) return <Loader />;
  const t = track.data;
  const patch = trackPatch(t, values, bpmTouched);
  const preview = resultingBpm(t, patch);
  const change = pending ? trackChangePreview(t, pending) : null;
  const badge = TRACK_STATUS_BADGES[t.status];
  const toggleCopy = toggle ? TOGGLE_COPY[toggle.key][toggle.value ? 'on' : 'off'] : null;
  const blocked = t.pendingCorrections > 0;
  const deleteConflict = remove.isError && isConflict(remove.error);
  const pendingLabel = blocked
    ? `${t.pendingCorrections} proposition${t.pendingCorrections > 1 ? 's' : ''} en attente dans Modération`
    : 'Propositions de correction dans Modération';

  // A write in flight (up to 2 min on a cold start) locks the page and its
  // modals, as the moderation DecisionForm: no second request, no way out.
  const saving = save.isPending;
  const removing = remove.isPending;
  const busy = saving || removing;
  const askToggle = (key: Toggle, value: boolean) => {
    if (busy) return;
    save.reset();
    setToggle({ key, value });
  };
  const closeSave = () => {
    if (!saving) setPending(null);
  };
  const closeToggle = () => {
    if (!saving) setToggle(null);
  };
  const closeDelete = () => {
    if (removing) return;
    setDeleteOpen(false);
    setTypedTitle('');
    remove.reset();
  };

  return (
    <Stack>
      <Anchor component={Link} to="/tracks">
        Retour à la liste
      </Anchor>
      <Group justify="space-between">
        <Group>
          <Title order={2}>{t.title}</Title>
          {t.titleMasked && (
            <Badge color="gray" variant="light">
              Titre masqué
            </Badge>
          )}
          {t.blacklisted && (
            <Badge color="red" variant="light">
              Blacklistée
            </Badge>
          )}
        </Group>
        <Badge size="lg" variant="light" color={badge.color}>
          {badge.label}
        </Badge>
      </Group>
      <Text c="dimmed">
        Ajoutée le {dayjs(t.createdAt).format('DD/MM/YYYY HH:mm')}
        {t.sourceKey ? ` · source ${t.sourceKey}` : ''} · tempo détecté :{' '}
        {t.rawBpm > 0 ? `${Math.round(t.rawBpm)} BPM` : 'aucun'}
      </Text>
      {t.status === 'ERROR' && (
        <Alert color="red" title="Tempo non détecté">
          Saisissez le MPM puis enregistrez pour publier la musique.
        </Alert>
      )}
      <Card withBorder>
        <Group align="flex-start" wrap="nowrap">
          {t.artwork && (
            <img
              src={trackArtworkUrl(t.artwork)}
              // CORS load: helmet's Cross-Origin-Resource-Policy: same-origin
              // blocks a no-cors image load from the back-office origin.
              crossOrigin="anonymous"
              alt="Pochette"
              width={120}
              height={120}
              style={{ objectFit: 'cover', borderRadius: 4 }}
            />
          )}
          <Stack gap="xs" style={{ flex: 1 }}>
            <audio
              ref={audioRef}
              aria-label="Lecteur de la musique"
              controls
              preload="metadata"
              crossOrigin="anonymous"
              src={trackAudioUrl(t.filename)}
              onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
              style={{ width: '100%' }}
            />
            <Text size="sm" c="dimmed">
              Position : {formatTimecode(position)}
            </Text>
          </Stack>
        </Group>
      </Card>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && Object.keys(patch).length > 0) {
            save.reset();
            setPending(patch);
          }
        }}
      >
        <Stack>
          <SimpleGrid cols={2}>
            <TextInput
              label="Titre"
              value={values.title}
              onChange={(e) => setValues({ ...values, title: e.currentTarget.value })}
            />
            <TextInput
              label="Artiste"
              value={values.artist}
              onChange={(e) => setValues({ ...values, artist: e.currentTarget.value })}
            />
            <Select
              label="Danse"
              clearable
              data={withLegacy(STYLE_OPTIONS, t.style)}
              value={values.style || null}
              onChange={(v) => setValues({ ...values, style: v ?? '' })}
            />
            <NumberInput
              label="MPM"
              min={0}
              max={400}
              allowDecimal={false}
              value={bpmTouched ? values.bpm : preview}
              description={
                !bpmTouched && patch.style !== undefined && preview !== t.bpm
                  ? 'Recalculé selon la danse'
                  : undefined
              }
              onChange={(v) => {
                setBpmTouched(true);
                setValues({ ...values, bpm: v });
              }}
            />
          </SimpleGrid>
          <ClashEditor
            value={values.clashes}
            onChange={(clashes) => setValues({ ...values, clashes })}
            audioRef={audioRef}
          />
          <Group>
            <Button type="submit" disabled={busy || Object.keys(patch).length === 0}>
              Enregistrer
            </Button>
          </Group>
        </Stack>
      </form>

      <Card withBorder>
        <Stack gap="xs">
          <Switch
            label="Masquer le titre"
            checked={t.titleMasked}
            disabled={busy}
            onChange={(e) => askToggle('titleMasked', e.currentTarget.checked)}
          />
          <Switch
            label="Blacklister"
            checked={t.blacklisted}
            disabled={busy}
            onChange={(e) => askToggle('blacklisted', e.currentTarget.checked)}
          />
          {/* Outside the Switch: a description inside its <label> would rename it. */}
          <Text size="xs" c="dimmed">
            Retire la musique de la bibliothèque de l'app
          </Text>
          <Anchor component={Link} to={`/moderation?track=${t.id}`} size="sm">
            {pendingLabel}
          </Anchor>
        </Stack>
      </Card>

      <Card withBorder style={{ borderColor: 'var(--mantine-color-red-6)' }}>
        <Stack gap="xs">
          <Title order={4} c="red">
            Zone dangereuse
          </Title>
          <Text size="sm">
            {blocked
              ? 'Suppression impossible tant que des propositions de correction attendent une décision : traitez-les dans Modération, ou blacklistez la musique.'
              : 'La musique, son fichier audio et sa pochette seront supprimés définitivement.'}
          </Text>
          <Group>
            <Button
              color="red"
              variant="outline"
              disabled={blocked || busy}
              onClick={() => {
                if (busy) return;
                remove.reset();
                setDeleteOpen(true);
              }}
            >
              Supprimer la musique
            </Button>
            {blocked && !t.blacklisted && (
              <Button
                variant="light"
                color="red"
                disabled={busy}
                onClick={() => askToggle('blacklisted', true)}
              >
                Blacklister à la place
              </Button>
            )}
          </Group>
        </Stack>
      </Card>

      <Title order={4}>Historique admin</Title>
      {history.isError ? (
        <Alert color="red">
          {apiErrorMessage(history.error, "Impossible de charger l'historique.")}
        </Alert>
      ) : history.data?.data.length ? (
        history.data.data.map((h) => (
          <Card key={h.id} withBorder p="xs">
            <Text size="sm" fw={500}>
              {dayjs(h.createdAt).format('DD/MM/YYYY HH:mm')} —{' '}
              {ACTION_LABELS[h.action] ?? h.action} par {h.actorName ?? 'admin supprimé'}
            </Text>
            {h.after && <ChangeSummary before={h.before ?? {}} after={h.after} />}
          </Card>
        ))
      ) : (
        <Text size="sm" c="dimmed">
          Aucune modification admin.
        </Text>
      )}

      <Modal
        opened={pending !== null}
        onClose={closeSave}
        closeOnEscape={!saving}
        closeOnClickOutside={!saving}
        withCloseButton={!saving}
        title="Confirmer les modifications"
      >
        {pending && change && (
          <Stack>
            <ChangeSummary before={change.before} after={change.after} />
            {save.isError && (
              <Alert color="red">{apiErrorMessage(save.error, "Échec de l'enregistrement")}</Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" disabled={saving} onClick={closeSave}>
                Annuler
              </Button>
              <Button loading={saving} onClick={() => !saving && save.mutate(pending)}>
                Confirmer
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={toggle !== null}
        onClose={closeToggle}
        closeOnEscape={!saving}
        closeOnClickOutside={!saving}
        withCloseButton={!saving}
        title={toggleCopy?.title}
      >
        {toggle && toggleCopy && (
          <Stack>
            <Text size="sm">{toggleCopy.text}</Text>
            {save.isError && (
              <Alert color="red">{apiErrorMessage(save.error, "Échec de l'enregistrement")}</Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" disabled={saving} onClick={closeToggle}>
                Annuler
              </Button>
              <Button
                color={toggle.key === 'blacklisted' && toggle.value ? 'red' : undefined}
                loading={saving}
                onClick={() => !saving && save.mutate(toggleBody(toggle.key, toggle.value))}
              >
                {toggleCopy.confirm}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={deleteOpen}
        onClose={closeDelete}
        closeOnEscape={!removing}
        closeOnClickOutside={!removing}
        withCloseButton={!removing}
        title="Supprimer cette musique"
      >
        <Stack>
          <Text size="sm">
            « {t.title} » sera supprimée définitivement, avec son fichier audio et sa pochette.
          </Text>
          {remove.isError && (
            <Alert color="red">{apiErrorMessage(remove.error, 'Suppression impossible')}</Alert>
          )}
          {deleteConflict && (
            <Anchor component={Link} to={`/moderation?track=${t.id}`} size="sm">
              Voir les propositions dans Modération
            </Anchor>
          )}
          <TextInput
            label="Recopiez le titre pour confirmer"
            placeholder={t.title}
            value={typedTitle}
            disabled={removing}
            onChange={(e) => setTypedTitle(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" disabled={removing} onClick={closeDelete}>
              Annuler
            </Button>
            {deleteConflict && !t.blacklisted ? (
              <Button
                color="red"
                variant="light"
                onClick={() => {
                  closeDelete();
                  askToggle('blacklisted', true);
                }}
              >
                Blacklister à la place
              </Button>
            ) : (
              <Button
                color="red"
                // After a 409 on a blacklisted track, a retry can only 409 again.
                disabled={deleteConflict || !titleConfirms(typedTitle, t.title)}
                loading={removing}
                onClick={() => !removing && remove.mutate()}
              >
                Supprimer définitivement
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
