import {
  Alert,
  Box,
  Button,
  Group,
  Image,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { authControllerLogin, healthControllerCheck } from '../api/generated/sdk.gen';
import type { AuthControllerLoginResponse } from '../api/generated/types.gen';
import { API_ORIGIN } from '../config';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { isAdmin, type SessionUser, useSession } from '../session/sessionStore';

// The login response has no Swagger DTO for `roles` (lot 1c): read it defensively.
type LoginUser = NonNullable<AuthControllerLoginResponse['user']> & { roles?: unknown };

const toRoles = (roles: unknown): string[] | undefined =>
  Array.isArray(roles) && roles.every((r) => typeof r === 'string') ? roles : undefined;

/** The generated login response marks every field optional: require them all. */
function toSessionUser(user: LoginUser | undefined): SessionUser | null {
  if (!user?.id || !user.email || !user.role) return null;
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    role: user.role,
    roles: toRoles(user.roles),
  };
}

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useSession((s) => s.setSession);
  const [awake, setAwake] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm({ initialValues: { email: '', password: '' } });

  // Scale-to-zero backend: wake it before the user submits (60-120 s worst case).
  // /health sits outside the global /api/v1 prefix, hence the origin baseUrl.
  useEffect(() => {
    let alive = true;
    void healthControllerCheck({ baseUrl: API_ORIGIN })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setAwake(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const onSubmit = form.onSubmit(async ({ email, password }) => {
    setError(null);
    setSubmitting(true);
    try {
      const { data, response } = await authControllerLogin({
        body: { username: email.trim(), password },
      });
      if (!data) {
        setError(response?.status === 401 ? 'Identifiants incorrects.' : UNAVAILABLE_MESSAGE);
        return;
      }
      const user = toSessionUser(data.user);
      if (!data.access_token || !data.refresh_token || !user) {
        setError(UNAVAILABLE_MESSAGE);
        return;
      }
      if (!isAdmin(user)) {
        setError('Accès réservé aux administrateurs.');
        return;
      }
      setSession({ accessToken: data.access_token, refreshToken: data.refresh_token, user });
      navigate('/users', { replace: true });
    } catch {
      setError(UNAVAILABLE_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <Box mih="100dvh" bg="var(--app-canvas)">
      <Box
        bg="var(--app-header-bg)"
        c="white"
        px="md"
        pt="calc(3rem + env(safe-area-inset-top))"
        pb={88}
        style={{ borderBottom: '3px solid var(--app-accent)' }}
      >
        <Stack align="center" gap={6}>
          <Image src="/icons/icon-192.png" alt="" w={64} h={64} radius="md" />
          <Text fw={700} fz={26} lh={1.2}>
            FFD Connect
          </Text>
          <Text size="sm" c="rgba(255,255,255,0.8)">
            Back-office d'administration
          </Text>
        </Stack>
      </Box>
      <Box px="md" mt={-56} pb="calc(2rem + env(safe-area-inset-bottom))">
        <Paper maw={400} mx="auto" p={{ base: 'lg', sm: 'xl' }} withBorder shadow="md">
          <form onSubmit={onSubmit}>
            <Stack>
              <Title order={2}>Connexion</Title>
              {!awake && (
                <Group gap="xs" wrap="nowrap">
                  <Loader size="xs" />
                  <Text size="sm" c="dimmed">
                    Réveil du serveur… (jusqu'à 2 minutes)
                  </Text>
                </Group>
              )}
              {error && <Alert color="red">{error}</Alert>}
              <TextInput
                label="Email"
                type="email"
                autoComplete="username"
                inputMode="email"
                required
                {...form.getInputProps('email')}
              />
              <PasswordInput
                label="Mot de passe"
                autoComplete="current-password"
                required
                {...form.getInputProps('password')}
              />
              <Button type="submit" fullWidth mt="xs" loading={submitting} disabled={!awake}>
                Se connecter
              </Button>
            </Stack>
          </form>
        </Paper>
      </Box>
    </Box>
  );
}
