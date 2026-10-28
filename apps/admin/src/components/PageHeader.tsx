import { Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  /** One line under the title saying what the page is for. */
  description?: ReactNode;
  /** Badges shown next to the title (status of the record…). */
  badges?: ReactNode;
  /** Page actions; they wrap under the title on a phone. */
  actions?: ReactNode;
}

/** Title row shared by the pages: same size, spacing and action placement. */
export function PageHeader({ title, description, badges, actions }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="flex-end" gap="sm" wrap="wrap">
      <Stack gap={4} miw={0} style={{ flex: '1 1 16rem' }}>
        <Group gap="xs" wrap="wrap">
          <Title order={1} size="h2" style={{ overflowWrap: 'anywhere' }}>
            {title}
          </Title>
          {badges}
        </Group>
        {description && (
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        )}
      </Stack>
      {actions && (
        <Group gap="xs" wrap="wrap">
          {actions}
        </Group>
      )}
    </Group>
  );
}
