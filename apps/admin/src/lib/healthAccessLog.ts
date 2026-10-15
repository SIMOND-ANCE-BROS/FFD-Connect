import type { HealthDataAccessLogEntryDto } from '../api/generated/types.gen';
import type { HealthAccessFilter } from '../api/queries';

export type HealthAccessAction = HealthDataAccessLogEntryDto['action'];
export type HealthActorRole = HealthDataAccessLogEntryDto['actorRole'];
export type HealthResourceType = HealthDataAccessLogEntryDto['resourceType'];

/** Exactly the generated unions: a value added on the backend fails the typecheck. */
export const HEALTH_ACTION_LABELS: Record<HealthAccessAction, string> = {
  READ: 'Consultation',
  DOWNLOAD: 'Téléchargement',
  EXPORT: 'Export',
  DELETE: 'Suppression',
};

export const HEALTH_ACTIONS = Object.keys(HEALTH_ACTION_LABELS) as HealthAccessAction[];

export const ACTOR_ROLE_LABELS: Record<HealthActorRole, string> = {
  ADMIN: 'Administrateur',
  OWNER: 'La personne elle-même',
  IMPERSONATOR: 'Connexion « en tant que »',
  SYSTEM: 'Traitement automatique',
};

export const RESOURCE_LABELS: Record<HealthResourceType, string> = {
  LICENSE_RENEWAL_REQUEST: 'Demande de renouvellement',
  MEDICAL_CERTIFICATE: 'Certificat médical',
};

/** Entry points written by the API (HEALTH_DATA_ACCESS_ROUTES); an unknown one is shown as is. */
const ROUTE_LABELS: Record<string, string> = {
  'GET /admin/license-renewals/:id': 'Back-office : fiche de renouvellement',
  'GET /admin/license-renewals/:id/documents/:docId/file': 'Back-office : ouverture du document',
  'GET /users/me/export': 'App : export de ses données',
  'POST /licenses/renewal/:id/documents': "App : envoi d'un document",
  'DELETE /users/me': 'App : suppression de son compte',
  'DELETE /admin/users/:id': 'Back-office : suppression du compte',
  'job:health-data-retention': 'Purge à la fin de la durée de conservation',
};

export const routeLabel = (route: string): string => ROUTE_LABELS[route] ?? route;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isAction = (value: string | null): value is HealthAccessAction =>
  HEALTH_ACTIONS.some((a) => a === value);

export interface HealthAccessUrlState {
  /** Person whose health data was accessed. */
  subject?: string;
  /** Author of the access. */
  actor?: string;
  action?: HealthAccessAction;
  page: number;
}

/** Filters kept in the URL (#443): `?subject=<uuid>&actor=<uuid>&action=READ&page=2`. */
export function readHealthAccessParams(params: URLSearchParams): HealthAccessUrlState {
  const subject = params.get('subject') ?? '';
  const actor = params.get('actor') ?? '';
  const action = params.get('action');
  const page = Number(params.get('page'));
  return {
    ...(UUID.test(subject) && { subject }),
    ...(UUID.test(actor) && { actor }),
    ...(isAction(action) && { action }),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** New params with `patch` applied; any filter change goes back to the first page. */
export function writeHealthAccessParams(
  current: URLSearchParams,
  patch: Partial<HealthAccessUrlState>,
): URLSearchParams {
  const next = { ...readHealthAccessParams(current), ...patch };
  if (patch.page === undefined) next.page = 1;
  const params = new URLSearchParams();
  if (next.subject) params.set('subject', next.subject);
  if (next.actor) params.set('actor', next.actor);
  if (next.action) params.set('action', next.action);
  if (next.page > 1) params.set('page', String(next.page));
  return params;
}

/** API filter of one journal page of `take` rows. */
export function healthAccessFilter(state: HealthAccessUrlState, take: number): HealthAccessFilter {
  return {
    ...(state.subject && { subjectUserId: state.subject }),
    ...(state.actor && { actorUserId: state.actor }),
    ...(state.action && { action: state.action }),
    skip: (state.page - 1) * take,
    take,
  };
}

/** Journal of one person, from their record page. */
export const subjectJournalPath = (userId: string): string =>
  `/health-data-access-log?subject=${userId}`;

/** Ids whose name the page must look up (subjects and actors), without duplicates. */
export function userIdsOf(
  entries: readonly HealthDataAccessLogEntryDto[],
  extra: readonly (string | undefined)[] = [],
): string[] {
  const ids = new Set<string>();
  for (const e of entries) {
    ids.add(e.subjectUserId);
    if (e.actorUserId) ids.add(e.actorUserId);
  }
  for (const id of extra) if (id) ids.add(id);
  return [...ids];
}
