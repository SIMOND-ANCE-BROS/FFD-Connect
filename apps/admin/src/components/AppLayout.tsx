import { AppShell, Button, Group, NavLink, Text } from '@mantine/core';
import { NavLink as RouterLink, Outlet, useNavigate } from 'react-router';
import { useSession } from '../session/sessionStore';

export function AppLayout() {
  const user = useSession((s) => s.user);
  const clear = useSession((s) => s.clear);
  const navigate = useNavigate();
  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 220, breakpoint: 'sm' }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Text fw={700}>FFD Connect — Admin</Text>
          <Group>
            <Text size="sm">
              {user?.firstName} {user?.lastName}
            </Text>
            <Button
              variant="subtle"
              size="xs"
              onClick={() => {
                clear();
                navigate('/login', { replace: true });
              }}
            >
              Déconnexion
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="sm">
        <NavLink component={RouterLink} to="/users" label="Inscrits" />
        <NavLink component={RouterLink} to="/club-accounts/new" label="Nouveau compte Club" />
        <NavLink component={RouterLink} to="/audit-log" label="Journal d'audit" />
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
