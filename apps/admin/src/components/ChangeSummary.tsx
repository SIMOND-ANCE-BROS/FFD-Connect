import { Table } from '@mantine/core';
import { REGISTRATION_MODE_LABELS, ROLE_LABELS } from '../lib/labels';

const LABELS: Record<string, string> = {
  firstName: 'Prénom',
  lastName: 'Nom',
  clubId: 'Club',
  clubName: 'Club',
  category: 'Catégorie',
  ageGroup: "Classe d'âge",
  passportLevelLatin: 'Passeport Latine',
  passportLevelStandard: 'Passeport Standard',
  competitionLevel: 'Niveau compétition',
  nationalRanking: 'Classement national',
  role: 'Rôle',
  extraRoles: 'Rôles supplémentaires',
  email: 'Email',
  name: 'Nom du club',
  registrationMode: "Mode d'inscription",
};

const VALUE_LABELS: Record<string, Record<string, string>> = {
  role: ROLE_LABELS,
  extraRoles: ROLE_LABELS,
  registrationMode: REGISTRATION_MODE_LABELS,
};

function display(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) {
    return value.length
      ? value.map((v) => VALUE_LABELS[key]?.[String(v)] ?? String(v)).join(', ')
      : '—';
  }
  const text = String(value);
  return VALUE_LABELS[key]?.[text] ?? text;
}

export function ChangeSummary({
  before,
  after,
}: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Champ</Table.Th>
          <Table.Th>Avant</Table.Th>
          <Table.Th>Après</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {Object.keys(after)
          // Audit rows carry both clubId and clubName: show the name only.
          .filter((k) => !(k === 'clubId' && 'clubName' in after))
          .map((k) => (
            <Table.Tr key={k}>
              <Table.Td>{LABELS[k] ?? k}</Table.Td>
              <Table.Td>{display(k, before[k])}</Table.Td>
              <Table.Td>{display(k, after[k])}</Table.Td>
            </Table.Tr>
          ))}
      </Table.Tbody>
    </Table>
  );
}
