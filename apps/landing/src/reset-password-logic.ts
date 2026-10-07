// Pure logic of the web reset-password page (kept free of DOM access so it can
// be unit-tested). The password rules mirror
// apps/backend/src/auth/password-validator.ts: keep both in sync.

export const MIN_LENGTH = 8;

const RULES: ReadonlyArray<{ test: (pw: string) => boolean; message: string }> = [
  {
    test: (pw) => pw.length >= MIN_LENGTH,
    message: `Le mot de passe doit contenir au moins ${MIN_LENGTH} caractères`,
  },
  {
    test: (pw) => /[A-Z]/.test(pw),
    message: 'Le mot de passe doit contenir au moins une majuscule',
  },
  {
    test: (pw) => /[a-z]/.test(pw),
    message: 'Le mot de passe doit contenir au moins une minuscule',
  },
  {
    test: (pw) => /[0-9]/.test(pw),
    message: 'Le mot de passe doit contenir au moins un chiffre',
  },
  {
    test: (pw) => /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(pw),
    message:
      'Le mot de passe doit contenir au moins un caractère spécial (!@#$%^&*()_+-=[]{}|;:,.<>?)',
  },
];

export function readToken(search: string): string | null {
  const token = new URLSearchParams(search).get('token');
  return token ? token : null;
}

export function validatePassword(pw: string): string[] {
  return RULES.filter((rule) => !rule.test(pw)).map((rule) => rule.message);
}

export function apiUrl(base: string): string {
  return `${base.replace(/\/+$/, '')}/auth/reset-password`;
}

export type ApiOutcome = { networkError: true } | { status: number; body?: unknown };

export interface UiResult {
  kind: 'success' | 'error';
  messages: string[];
  /** The token itself was rejected: retrying with it is pointless. */
  linkInvalid?: boolean;
}

const HINT = "Demandez un nouveau lien depuis l'application (« Mot de passe oublié »).";
const INVALID_LINK = `Ce lien est invalide, expiré ou déjà utilisé. ${HINT}`;
const UNAVAILABLE = 'Serveur indisponible pour le moment. Réessayez dans quelques instants.';
// Backend text for a bad token: "Token de réinitialisation invalide, expiré ou déjà utilisé".
const TOKEN_REJECTED = /invalide, expiré ou déjà utilisé/i;

function stringList(value: unknown): string[] | null {
  if (typeof value === 'string') return value ? [value] : null;
  if (!Array.isArray(value)) return null;
  const list = value.filter((e): e is string => typeof e === 'string');
  return list.length > 0 ? list : null;
}

// The global HttpExceptionFilter returns { statusCode, ..., message }, where
// message is a string or, for ValidationPipe errors, a string array.
function badRequest(body: unknown): UiResult {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const errors = Array.isArray(record.errors) ? stringList(record.errors) : null;
  const messages = errors ?? stringList(record.message);
  if (!messages) return { kind: 'error', messages: [INVALID_LINK], linkInvalid: true };
  if (messages.some((m) => TOKEN_REJECTED.test(m))) {
    return {
      kind: 'error',
      messages: [`Ce lien est invalide, expiré ou déjà utilisé. ${HINT}`],
      linkInvalid: true,
    };
  }
  return { kind: 'error', messages };
}

export function describeResult(outcome: ApiOutcome): UiResult {
  if ('networkError' in outcome) {
    return { kind: 'error', messages: [UNAVAILABLE] };
  }
  const { status } = outcome;
  if (status >= 200 && status < 300) {
    return {
      kind: 'success',
      messages: [
        "Mot de passe enregistré. Vous pouvez maintenant vous connecter dans l'application FFD Connect.",
      ],
    };
  }
  if (status === 400) return badRequest(outcome.body);
  if (status === 429) {
    return {
      kind: 'error',
      messages: ['Trop de tentatives. Réessayez dans quelques minutes.'],
    };
  }
  return { kind: 'error', messages: [UNAVAILABLE] };
}
