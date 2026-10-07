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
}

const INVALID_LINK =
  "Ce lien est invalide, expiré ou déjà utilisé. Demandez un nouveau lien depuis l'application (« Mot de passe oublié »).";
const UNAVAILABLE = 'Serveur indisponible pour le moment. Réessayez dans quelques instants.';

function errorList(body: unknown): string[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return null;
  const list = errors.filter((e): e is string => typeof e === 'string');
  return list.length > 0 ? list : null;
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
  if (status === 400) {
    return {
      kind: 'error',
      messages: errorList(outcome.body) ?? [INVALID_LINK],
    };
  }
  if (status === 429) {
    return {
      kind: 'error',
      messages: ['Trop de tentatives. Réessayez dans quelques minutes.'],
    };
  }
  return { kind: 'error', messages: [UNAVAILABLE] };
}
