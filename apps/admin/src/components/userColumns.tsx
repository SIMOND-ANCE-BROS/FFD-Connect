import { Anchor, Badge, Group, Text } from '@mantine/core';
import { Link } from 'react-router';
import type { AdminUserListItemDto } from '../api/generated/types.gen';
import { formatDiscipline } from '../lib/discipline';
import { extraRoleLabels, ROLE_LABELS } from '../lib/labels';
import type { UsersFilterField } from '../lib/userList';
import type { ColumnFilter, DataTableColumn } from './DataTable';
import { StoreReviewBadge } from './StoreReview';
import { formatParisDay } from '../lib/parisDate';

export const LICENSE_LABEL: Record<'ACTIVE' | 'EXPIRED', string> = {
  ACTIVE: 'Active',
  EXPIRED: 'Expirée',
};

export const formatDay = (iso: string | null) => formatParisDay(iso);

export function ExtraRoles({ user }: { user: AdminUserListItemDto }) {
  if (user.extraRoles.length === 0) return <>—</>;
  return (
    <Group gap={4}>
      {extraRoleLabels(user.extraRoles).map((l) => (
        <Badge key={l} variant="outline" size="sm">
          {l}
        </Badge>
      ))}
    </Group>
  );
}

export interface UserColumnsOptions {
  filter: (field: UsersFilterField) => ColumnFilter;
  /** The name links to the user record; off in a modal, where it would leave the dialog. */
  recordLinks?: boolean;
  /** Club the accounts are being linked to (#558): its members are flagged « Déjà membre ». */
  memberOf?: string;
}

/**
 * Columns of the user list (#443, #444, #556, #557), shared by the Users page
 * and the « Lier des membres » dialog (#558): same columns, same filters.
 */
export function userColumns({
  filter,
  recordLinks = true,
  memberOf,
}: UserColumnsOptions): DataTableColumn<AdminUserListItemDto>[] {
  return [
    {
      key: 'name',
      minWidth: 170,
      weight: 2,
      label: 'Nom',
      required: true,
      sortField: 'name',
      cell: (u) => (
        <>
          {recordLinks ? (
            <Anchor
              component={Link}
              to={`/users/${u.id}`}
              onClick={(event) => event.stopPropagation()}
              fw={600}
            >
              {u.lastName} {u.firstName}
            </Anchor>
          ) : (
            <Text component="span" fw={600} size="sm">
              {u.lastName} {u.firstName}
            </Text>
          )}
          {u.isStoreReview && <StoreReviewBadge />}
        </>
      ),
      filter: filter('name'),
    },
    {
      key: 'email',
      minWidth: 170,
      weight: 2,
      priority: 1,
      label: 'Email',
      sortField: 'email',
      cell: (u) => u.email,
      filter: filter('email'),
    },
    {
      key: 'role',
      minWidth: 165,
      priority: 2,
      label: 'Rôle principal',
      sortField: 'role',
      cell: (u) => <Badge variant="light">{ROLE_LABELS[u.role]}</Badge>,
      filter: filter('role'),
    },
    {
      key: 'extraRoles',
      minWidth: 170,
      weight: 1.5,
      priority: 9,
      wrap: true,
      label: 'Rôles supplémentaires',
      cell: (u) => <ExtraRoles user={u} />,
    },
    {
      key: 'status',
      minWidth: 120,
      priority: 4,
      label: 'Compte',
      cell: (u) =>
        u.disabledAt ? (
          <Badge color="red" variant="light">
            Désactivé
          </Badge>
        ) : (
          'Actif'
        ),
      filter: filter('status'),
    },
    {
      key: 'club',
      minWidth: 140,
      weight: 1.5,
      priority: memberOf ? 0 : 3,
      label: 'Club',
      sortField: 'club',
      cell: (u) =>
        memberOf && u.clubId === memberOf ? (
          <Badge variant="light" color="gray">
            Déjà membre
          </Badge>
        ) : (
          (u.clubName ?? (memberOf ? 'Sans club' : '—'))
        ),
      filter: filter('club'),
    },
    {
      key: 'category',
      minWidth: 145,
      priority: 5,
      label: 'Catégorie',
      sortField: 'category',
      cell: (u) => (u.category ? formatDiscipline(u.category) : '—'),
      filter: filter('category'),
    },
    {
      key: 'ageGroup',
      minWidth: 140,
      priority: 8,
      label: "Classe d'âge",
      sortField: 'ageGroup',
      cell: (u) => u.ageGroup ?? '—',
      filter: filter('ageGroup'),
    },
    {
      key: 'license',
      minWidth: 90,
      priority: 7,
      label: 'Licence',
      cell: (u) => (u.licenseStatus ? LICENSE_LABEL[u.licenseStatus] : '—'),
    },
    {
      key: 'licenseNumber',
      minWidth: 130,
      priority: 10,
      label: 'N° de licence',
      hiddenByDefault: true,
      cell: (u) => u.licenseNumber ?? '—',
      filter: filter('licenseNumber'),
    },
    {
      key: 'createdAt',
      minWidth: 155,
      priority: 6,
      label: 'Inscription',
      sortField: 'createdAt',
      cell: (u) => formatDay(u.createdAt),
      filter: filter('createdAt'),
    },
    {
      key: 'lastLoginAt',
      minWidth: 160,
      priority: 11,
      label: 'Dernière connexion',
      sortField: 'lastLoginAt',
      hiddenByDefault: true,
      cell: (u) => formatDay(u.lastLoginAt),
      filter: filter('lastLoginAt'),
    },
  ];
}
