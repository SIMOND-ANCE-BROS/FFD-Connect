import { Table } from '@mantine/core';

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
  email: 'Email',
};

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
        {Object.keys(after).map((k) => (
          <Table.Tr key={k}>
            <Table.Td>{LABELS[k] ?? k}</Table.Td>
            <Table.Td>{String(before[k] ?? '—')}</Table.Td>
            <Table.Td>{String(after[k] ?? '—')}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
