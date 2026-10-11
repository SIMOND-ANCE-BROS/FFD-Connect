import { Paper, Skeleton, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';

/** Placeholder rows while a list loads; announced to screen readers. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Stack gap="xs" role="status" aria-label="Chargement…">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={44} radius="sm" />
      ))}
    </Stack>
  );
}

/** Empty list: says what is empty and, when useful, what to do next. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Paper withBorder p="xl" ta="center" style={{ borderStyle: 'dashed' }}>
      <Text fw={600}>{title}</Text>
      {children && (
        <Text size="sm" c="dimmed" mt={4}>
          {children}
        </Text>
      )}
    </Paper>
  );
}
