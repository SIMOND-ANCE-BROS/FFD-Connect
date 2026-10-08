import { Alert, Button, Group, Loader, Modal, Stack, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminControllerUpdateUser } from '../api/generated/sdk.gen';
import type { AdminUserListItemDto } from '../api/generated/types.gen';
import { clubQuery, unwrap, usersQuery } from '../api/queries';
import { apiErrorMessage } from '../lib/apiError';

const MIN_SEARCH_LENGTH = 2;
const RESULTS = 10;

interface Props {
  club: { id: string; name: string };
  opened: boolean;
  onClose: () => void;
}

/** Attaches an existing account to this club by searching users (PATCH clubId). */
export function LinkMemberModal({ club, opened, onClose }: Props) {
  return (
    <Modal opened={opened} onClose={onClose} title="Lier un membre" size="lg">
      <LinkMemberBody club={club} onClose={onClose} />
    </Modal>
  );
}

function LinkMemberBody({ club, onClose }: Omit<Props, 'opened'>) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [confirming, setConfirming] = useState<AdminUserListItemDto | null>(null);
  const searching = debounced.length >= MIN_SEARCH_LENGTH;
  const results = useQuery({
    ...usersQuery({ search: debounced, skip: 0, take: RESULTS }),
    enabled: searching,
  });

  const link = useMutation({
    mutationFn: (user: AdminUserListItemDto) =>
      unwrap(adminControllerUpdateUser({ path: { id: user.id }, body: { clubId: club.id } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubQuery(club.id).queryKey });
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'user'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'clubs'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
      notifications.show({ color: 'green', message: 'Membre ajouté au club' });
      onClose();
    },
  });

  const choose = (user: AdminUserListItemDto) => {
    link.reset();
    // A legacy account may carry a club name without a clubId: still a club.
    if (user.clubName) setConfirming(user);
    else link.mutate(user);
  };

  if (confirming) {
    return (
      <Stack>
        <Text>
          {confirming.firstName} {confirming.lastName} quitte {confirming.clubName} pour {club.name}
        </Text>
        {link.isError && (
          <Alert color="red">{apiErrorMessage(link.error, "Impossible d'ajouter ce membre")}</Alert>
        )}
        <Group justify="flex-end">
          <Button
            variant="default"
            onClick={() => {
              link.reset();
              setConfirming(null);
            }}
          >
            Annuler
          </Button>
          <Button loading={link.isPending} onClick={() => link.mutate(confirming)}>
            Confirmer
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack>
      <TextInput
        label="Rechercher un utilisateur"
        placeholder="Nom, prénom ou email"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        data-autofocus
      />
      {link.isError && (
        <Alert color="red">{apiErrorMessage(link.error, "Impossible d'ajouter ce membre")}</Alert>
      )}
      {!searching ? (
        <Text size="sm" c="dimmed">
          Saisissez au moins {MIN_SEARCH_LENGTH} caractères.
        </Text>
      ) : results.isError ? (
        <Alert color="red">
          {apiErrorMessage(results.error, 'Impossible de charger les utilisateurs.')}
        </Alert>
      ) : results.isPending ? (
        <Loader size="sm" />
      ) : results.data.data.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucun utilisateur trouvé.
        </Text>
      ) : (
        <Table>
          <Table.Tbody>
            {results.data.data.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {u.lastName} {u.firstName}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {u.email}
                  </Text>
                </Table.Td>
                <Table.Td>{u.clubName ?? 'Sans club'}</Table.Td>
                <Table.Td>
                  {u.clubId === club.id ? (
                    <Text size="sm" c="dimmed">
                      Déjà membre
                    </Text>
                  ) : (
                    <Button
                      size="xs"
                      variant="light"
                      loading={link.isPending && link.variables.id === u.id}
                      onClick={() => choose(u)}
                      aria-label={`Ajouter ${u.firstName} ${u.lastName}`}
                    >
                      Ajouter
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
