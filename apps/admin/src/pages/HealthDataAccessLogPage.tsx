import { Anchor, Badge, Pagination, Radio, Stack, Text } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link } from 'react-router';
import type { HealthDataAccessLogEntryDto } from '../api/generated/types.gen';
import { healthAccessLogQuery } from '../api/queries';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState } from '../components/ListStates';
import { PageHeader } from '../components/PageHeader';
import { RecordCard, RecordLine } from '../components/RecordCard';
import { UserPicker } from '../components/UserPicker';
import { apiErrorMessage } from '../lib/apiError';
import {
  ACTOR_ROLE_LABELS,
  HEALTH_ACTION_LABELS,
  HEALTH_ACTIONS,
  type HealthAccessAction,
  healthAccessFilter,
  readHealthAccessParams,
  RESOURCE_LABELS,
  routeLabel,
  userIdsOf,
  writeHealthAccessParams,
} from '../lib/healthAccessLog';
import { useListParams } from '../lib/useListParams';
import { useUserNames } from '../lib/useUserNames';

/** Each row resolves up to two names: a short page keeps that bounded. */
const PAGE_SIZE = 25;

type Entry = HealthDataAccessLogEntryDto;

const createdAt = (e: Entry) => dayjs(e.createdAt).format('DD/MM/YYYY HH:mm');
const subjectPath = (e: Entry) => `/users/${e.subjectUserId}`;

/**
 * Health-data access journal (#63, #606): who read, downloaded, exported or
 * deleted a medical certificate or a renewal request, newest first. The API
 * gives ids only; names come from the user records, on this side.
 */
export function HealthDataAccessLogPage() {
  const [state, update] = useListParams(readHealthAccessParams, writeHealthAccessParams);
  const log = useQuery({
    ...healthAccessLogQuery(healthAccessFilter(state, PAGE_SIZE)),
    placeholderData: keepPreviousData,
  });
  const rows = log.data?.data ?? [];
  const nameOf = useUserNames(userIdsOf(rows, [state.subject, state.actor]));
  const total = log.data?.meta.total ?? 0;

  const actorName = (e: Entry) => (e.actorUserId ? nameOf(e.actorUserId) : 'Système');

  const chips = [
    ...(state.subject
      ? [
          {
            key: 'subject',
            label: `Personne concernée : ${nameOf(state.subject)}`,
            onRemove: () => update({ subject: undefined }),
          },
        ]
      : []),
    ...(state.actor
      ? [
          {
            key: 'actor',
            label: `Auteur : ${nameOf(state.actor)}`,
            onRemove: () => update({ actor: undefined }),
          },
        ]
      : []),
    ...(state.action
      ? [
          {
            key: 'action',
            label: `Action : ${HEALTH_ACTION_LABELS[state.action]}`,
            onRemove: () => update({ action: undefined }),
          },
        ]
      : []),
  ];

  const columns: DataTableColumn<Entry>[] = [
    {
      key: 'createdAt',
      minWidth: 150,
      priority: 0,
      label: 'Date',
      cell: createdAt,
    },
    {
      key: 'subject',
      minWidth: 160,
      weight: 1.5,
      label: 'Personne concernée',
      required: true,
      cell: (e) => (
        <Anchor component={Link} to={subjectPath(e)} size="sm">
          {nameOf(e.subjectUserId)}
        </Anchor>
      ),
      filter: {
        active: state.subject !== undefined,
        content: (
          <UserPicker
            label="Personne concernée"
            value={state.subject}
            valueLabel={state.subject && nameOf(state.subject)}
            onChange={(subject) => update({ subject })}
          />
        ),
      },
    },
    {
      key: 'actor',
      minWidth: 160,
      weight: 1.5,
      priority: 1,
      label: 'Auteur',
      cell: (e) => (
        <>
          {e.actorUserId ? (
            <Anchor component={Link} to={`/users/${e.actorUserId}`} size="sm">
              {actorName(e)}
            </Anchor>
          ) : (
            <Text size="sm">{actorName(e)}</Text>
          )}
          <Text size="xs" c="dimmed">
            {ACTOR_ROLE_LABELS[e.actorRole]}
          </Text>
        </>
      ),
      wrap: true,
      filter: {
        active: state.actor !== undefined,
        content: (
          <UserPicker
            label="Auteur"
            value={state.actor}
            valueLabel={state.actor && nameOf(state.actor)}
            onChange={(actor) => update({ actor })}
          />
        ),
      },
    },
    {
      key: 'action',
      minWidth: 140,
      priority: 2,
      label: 'Action',
      cell: (e) => <Badge variant="light">{HEALTH_ACTION_LABELS[e.action]}</Badge>,
      filter: {
        active: state.action !== undefined,
        content: (
          <Radio.Group
            aria-label="Action"
            value={state.action ?? ''}
            onChange={(v) => update({ action: v ? (v as HealthAccessAction) : undefined })}
          >
            <Stack gap="xs">
              <Radio value="" label="Toutes" />
              {HEALTH_ACTIONS.map((a) => (
                <Radio key={a} value={a} label={HEALTH_ACTION_LABELS[a]} />
              ))}
            </Stack>
          </Radio.Group>
        ),
      },
    },
    {
      key: 'resource',
      minWidth: 170,
      priority: 3,
      label: 'Donnée',
      cell: (e) => RESOURCE_LABELS[e.resourceType],
    },
    {
      key: 'route',
      minWidth: 220,
      weight: 2,
      priority: 4,
      wrap: true,
      label: 'Origine',
      cell: (e) => routeLabel(e.route),
    },
  ];

  const filtered = chips.length > 0;

  return (
    <Stack>
      <PageHeader
        title="Accès aux données de santé"
        description="Qui a consulté, téléchargé, exporté ou supprimé un certificat médical ou une demande de renouvellement, le plus récent en premier. Conservé un an."
      />
      <DataTable
        tableId="health-access-log"
        columns={columns}
        rows={rows}
        rowKey={(e) => e.id}
        rowHref={subjectPath}
        // The journal is always newest first: no column sort.
        sort={null}
        onSortChange={() => undefined}
        onResetFilters={() => update({ subject: undefined, actor: undefined, action: undefined })}
        filterChips={chips}
        loading={log.isPending}
        error={log.isError && apiErrorMessage(log.error, 'Impossible de charger le journal.')}
        summary={
          <Text size="sm" c="dimmed">
            {total} accès
          </Text>
        }
        empty={
          filtered ? (
            <EmptyState title="Aucun accès">Aucun accès ne correspond à ces filtres.</EmptyState>
          ) : (
            <EmptyState title="Journal vide">
              Aucun accès aux données de santé n'a encore été enregistré.
            </EmptyState>
          )
        }
        renderCard={(e) => (
          <RecordCard
            to={subjectPath(e)}
            title={nameOf(e.subjectUserId)}
            badges={<Badge variant="light">{HEALTH_ACTION_LABELS[e.action]}</Badge>}
          >
            <RecordLine label="Date">{createdAt(e)}</RecordLine>
            <RecordLine label="Auteur">
              {actorName(e)} ({ACTOR_ROLE_LABELS[e.actorRole]})
            </RecordLine>
            <RecordLine label="Donnée">{RESOURCE_LABELS[e.resourceType]}</RecordLine>
            <RecordLine label="Origine">{routeLabel(e.route)}</RecordLine>
          </RecordCard>
        )}
      />
      {!log.isError && total > PAGE_SIZE && (
        <Pagination
          total={Math.ceil(total / PAGE_SIZE)}
          value={state.page}
          onChange={(page) => update({ page })}
        />
      )}
    </Stack>
  );
}
