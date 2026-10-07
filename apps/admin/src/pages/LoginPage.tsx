import {
  Alert,
  Button,
  Center,
  Group,
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
import { type SessionUser, useSession } from '../session/sessionStore';

type LoginUser = NonNullable<AuthControllerLoginResponse['user']>;

/** The generated login response marks every field optional: require them all. */
function toSessionUser(user: LoginUser | undefined): SessionUser | null {
  if (!user?.id || !user.email || !user.role) return null;
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    role: user.role,
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
      if (user.role !== 'ADMIN') {
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
    <Center h="100vh">
      <Paper w={360} p="xl" withBorder>
        <form onSubmit={onSubmit}>
          <Stack>
            <Title order={2}>FFD Connect — Administration</Title>
            {!awake && (
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">
                  Réveil du serveur… (jusqu'à 2 minutes)
                </Text>
              </Group>
            )}
            {error && <Alert color="red">{error}</Alert>}
            <TextInput label="Email" type="email" required {...form.getInputProps('email')} />
            <PasswordInput label="Mot de passe" required {...form.getInputProps('password')} />
            <Button type="submit" loading={submitting} disabled={!awake}>
              Se connecter
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
