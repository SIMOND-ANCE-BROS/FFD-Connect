import { Alert, Table } from '@mantine/core';
import { apiErrorMessage } from '../lib/apiError';
import { type ImportReportCounts, lineErrors, reportRows } from '../lib/resultsImport';

/** Counts of a results import (dry run or real one). */
export function ReportTable({ report, title }: { report: ImportReportCounts; title: string }) {
  return (
    <Table withTableBorder maw={480} aria-label={title}>
      <Table.Tbody>
        {reportRows(report).map((row) => (
          // Zero counts step back so the rows that change something stand out.
          <Table.Tr key={row.key} c={row.value === '0' ? 'dimmed' : undefined}>
            <Table.Th scope="row" fw={row.value === '0' ? 400 : 500}>
              {row.label}
            </Table.Th>
            <Table.Td ta="right" fw={row.value === '0' ? 400 : 600}>
              {row.value}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

/** A refused file: its line errors when the API lists them, its message otherwise. */
export function ImportError({ error, fallback }: { error: unknown; fallback: string }) {
  const lines = lineErrors(error);
  return (
    <Alert color="red" title={apiErrorMessage(error, fallback)}>
      {lines.length > 0 && (
        <Table aria-label="Lignes en erreur" mt="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={80}>Ligne</Table.Th>
              <Table.Th>Erreur</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.map((e, i) => (
              <Table.Tr key={`${e.line}-${i}`}>
                <Table.Td>{e.line}</Table.Td>
                <Table.Td>{e.message}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Alert>
  );
}
