import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Burger,
  Button,
  Divider,
  Group,
  Image,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { NavLink as RouterLink, Outlet, useLocation, useNavigate } from 'react-router';
import { pendingCountQuery, pendingRenewalsCountQuery } from '../api/queries';
import { useSession } from '../session/sessionStore';

/** Queues whose pending count is shown as a badge in the menu. */
type Queue = 'moderation' | 'renewals';

interface NavItem {
  to: string;
  label: string;
  queue?: Queue;
}

/** Menu of the back-office, in display order: add a section with one line here. */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/users', label: 'Utilisateurs' },
  { to: '/clubs', label: 'Clubs' },
  { to: '/tracks', label: 'Musiques' },
  { to: '/moderation', label: 'Modération', queue: 'moderation' },
  { to: '/license-renewals', label: 'Renouvellements', queue: 'renewals' },
  { to: '/audit-log', label: "Journal d'audit" },
  { to: '/stats', label: 'Statistiques' },
  { to: '/usage', label: "Usage de l'app" },
];

const HEADER_HEIGHT = 'calc(3.5rem + env(safe-area-inset-top))';

/** Red counter of a queue in the menu; nothing when the queue is empty. */
const countBadge = (value: number) =>
  value > 0 ? (
    <Badge size="sm" color="red" circle={value < 10}>
      {value}
    </Badge>
  ) : null;

const isActive = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const dark = computed === 'dark';
  return (
    <ActionIcon
      variant="subtle"
      color="white"
      size="lg"
      aria-label={dark ? 'Passer en thème clair' : 'Passer en thème sombre'}
      onClick={() => setColorScheme(dark ? 'light' : 'dark')}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {dark ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </>
        ) : (
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        )}
      </svg>
    </ActionIcon>
  );
}

export function AppLayout() {
  const user = useSession((s) => s.user);
  const clear = useSession((s) => s.clear);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);
  const pending = useQuery(pendingCountQuery);
  const { refetch } = pending;
  const renewals = useQuery(pendingRenewalsCountQuery);
  const { refetch: refetchRenewals } = renewals;
  // Refreshed on navigation (and invalidated after a decision), never polled:
  // every request wakes the scale-to-zero backend.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    void refetch();
    void refetchRenewals();
  }, [pathname, refetch, refetchRenewals]);
  // On a phone the menu covers the page: any navigation (link, back button) closes it.
  useEffect(() => {
    closeNav();
  }, [pathname, closeNav]);

  const counts: Record<Queue, number> = {
    moderation: pending.data?.count ?? 0,
    renewals: renewals.data?.count ?? 0,
  };
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  const logout = () => {
    clear();
    navigate('/login', { replace: true });
  };

  return (
    <AppShell
      header={{ height: HEADER_HEIGHT }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
      padding={{ base: 'sm', sm: 'lg' }}
    >
      <AppShell.Header
        withBorder={false}
        bg="var(--app-header-bg)"
        c="white"
        pt="env(safe-area-inset-top)"
        style={{ borderBottom: '3px solid var(--app-accent)' }}
      >
        <Group h="100%" px={{ base: 'xs', sm: 'md' }} justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" miw={0}>
            <Burger
              opened={navOpened}
              onClick={toggleNav}
              hiddenFrom="sm"
              size="sm"
              color="white"
              aria-label={navOpened ? 'Fermer le menu' : 'Ouvrir le menu'}
              aria-expanded={navOpened}
              aria-controls="admin-navbar"
            />
            <Image src="/icons/icon-192.png" alt="" w={30} h={30} radius="sm" />
            <Box miw={0} lh={1.15}>
              <Text fw={700} size="md" truncate>
                FFD Connect
              </Text>
              <Text size="xs" c="rgba(255,255,255,0.75)" truncate>
                Administration
              </Text>
            </Box>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Text size="sm" visibleFrom="sm" c="rgba(255,255,255,0.85)">
              {fullName}
            </Text>
            <ColorSchemeToggle />
            <Button variant="white" color="ffd" size="xs" visibleFrom="sm" onClick={logout}>
              Déconnexion
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar id="admin-navbar" aria-label="Menu principal" component="nav">
        <AppShell.Section grow component={ScrollArea} p="sm">
          <Stack gap={2}>
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                component={RouterLink}
                to={item.to}
                label={item.label}
                active={isActive(pathname, item.to)}
                rightSection={item.queue ? countBadge(counts[item.queue]) : undefined}
                onClick={closeNav}
                style={{ borderRadius: 'var(--mantine-radius-md)' }}
                fw={500}
              />
            ))}
          </Stack>
        </AppShell.Section>
        <AppShell.Section
          hiddenFrom="sm"
          p="sm"
          pb="calc(var(--mantine-spacing-sm) + env(safe-area-inset-bottom))"
        >
          <Divider mb="sm" />
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" c="dimmed" truncate>
              {fullName}
            </Text>
            <Button variant="light" onClick={logout}>
              Déconnexion
            </Button>
          </Group>
        </AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Main
        bg="var(--app-canvas)"
        pb="calc(var(--mantine-spacing-lg) + env(safe-area-inset-bottom))"
      >
        <Box maw={1400} mx="auto">
          <Outlet />
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
