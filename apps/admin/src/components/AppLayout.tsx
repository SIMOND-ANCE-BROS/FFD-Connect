import { AppShell, Badge, Button, Group, NavLink, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { NavLink as RouterLink, Outlet, useLocation, useNavigate } from 'react-router';
import { pendingCountQuery } from '../api/queries';
import { useSession } from '../session/sessionStore';

export function AppLayout() {
  const user = useSession((s) => s.user);
  const clear = useSession((s) => s.clear);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pending = useQuery(pendingCountQuery);
  const { refetch } = pending;
  // Refreshed on navigation (and invalidated after a decision), never polled:
  // every request wakes the scale-to-zero backend.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    void refetch();
  }, [pathname, refetch]);
  const count = pending.data?.count ?? 0;

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
        <NavLink component={RouterLink} to="/users" label="Utilisateurs" />
        <NavLink component={RouterLink} to="/clubs" label="Clubs" />
        <NavLink component={RouterLink} to="/tracks" label="Musiques" />
        <NavLink
          component={RouterLink}
          to="/moderation"
          label="Modération"
          rightSection={
            count > 0 ? (
              <Badge size="sm" color="red" circle={count < 10}>
                {count}
              </Badge>
            ) : null
          }
        />
        <NavLink component={RouterLink} to="/audit-log" label="Journal d'audit" />
        <NavLink component={RouterLink} to="/stats" label="Statistiques" />
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
