import { Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

interface RecordCardProps {
  /** Record page the card opens. */
  to: string;
  title: ReactNode;
  /** Badges next to the title. */
  badges?: ReactNode;
  /** Secondary lines (email, club, date…). */
  children?: ReactNode;
}

/**
 * Phone version of a table row: the whole card is the link, so the touch
 * target spans the full width and nothing depends on hover.
 */
export function RecordCard({ to, title, badges, children }: RecordCardProps) {
  return (
    <UnstyledButton component={Link} to={to} display="block">
      <Paper withBorder p="sm">
        <Stack gap={6}>
          <Group gap="xs" wrap="wrap">
            <Text
              fw={600}
              c="var(--mantine-primary-color-filled)"
              style={{ overflowWrap: 'anywhere' }}
            >
              {title}
            </Text>
            {badges}
          </Group>
          {children}
        </Stack>
      </Paper>
    </UnstyledButton>
  );
}

/** A "label : value" line inside a card. */
export function RecordLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Text size="sm" component="div" style={{ overflowWrap: 'anywhere' }}>
      <Text span size="sm" c="dimmed">
        {label} :{' '}
      </Text>
      {children}
    </Text>
  );
}

/** Vertical list of cards (phone layout of a table). */
export function RecordList({ children }: { children: ReactNode }) {
  return <Stack gap="xs">{children}</Stack>;
}
