import { Button, Collapse, Group, Paper, Stack } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useId, type ReactNode } from 'react';
import { useIsMobile } from '../lib/useIsMobile';

interface FilterPanelProps {
  /** Filters currently narrowing the list (shown as « Filtres (n) »). */
  activeCount: number;
  /** Puts every filter of the panel back to its default. */
  onReset: () => void;
  children: ReactNode;
}

/**
 * Secondary filters of a list page. On a desktop they are shown as-is; on a
 * phone they fold behind a « Filtres » button so the list starts on the first
 * screen, with the number of active filters and a reset action.
 */
export function FilterPanel({ activeCount, onReset, children }: FilterPanelProps) {
  const isMobile = useIsMobile();
  const [opened, { toggle }] = useDisclosure(false);
  const panelId = useId();
  if (!isMobile) return <>{children}</>;
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Button
          variant={activeCount > 0 ? 'light' : 'default'}
          onClick={toggle}
          aria-expanded={opened}
          aria-controls={panelId}
        >
          {activeCount > 0 ? `Filtres (${activeCount})` : 'Filtres'}
        </Button>
        {activeCount > 0 && (
          <Button variant="subtle" onClick={onReset}>
            Réinitialiser
          </Button>
        )}
      </Group>
      <Collapse in={opened} id={panelId}>
        <Paper withBorder p="sm">
          <Stack gap="sm">{children}</Stack>
        </Paper>
      </Collapse>
    </Stack>
  );
}
