import { describe, expect, it } from 'vitest';
import { apiUrl, describeResult, readToken, validatePassword } from './reset-password-logic';

describe('readToken', () => {
  it('returns the token from the query string', () => {
    expect(readToken('?token=abc123')).toBe('abc123');
  });
  it('returns null when absent or empty', () => {
    expect(readToken('')).toBeNull();
    expect(readToken('?foo=bar')).toBeNull();
    expect(readToken('?token=')).toBeNull();
  });
});

describe('validatePassword', () => {
  it('accepts a valid password', () => {
    expect(validatePassword('Abcdef1!')).toEqual([]);
  });
  it('rejects a short password', () => {
    expect(validatePassword('Ab1!')).toEqual([
      'Le mot de passe doit contenir au moins 8 caractères',
    ]);
  });
  it('requires an uppercase letter', () => {
    expect(validatePassword('abcdef1!')).toEqual([
      'Le mot de passe doit contenir au moins une majuscule',
    ]);
  });
  it('requires a lowercase letter', () => {
    expect(validatePassword('ABCDEF1!')).toEqual([
      'Le mot de passe doit contenir au moins une minuscule',
    ]);
  });
  it('requires a digit', () => {
    expect(validatePassword('Abcdefg!')).toEqual([
      'Le mot de passe doit contenir au moins un chiffre',
    ]);
  });
  it('requires a special character', () => {
    expect(validatePassword('Abcdefg1')).toEqual([
      'Le mot de passe doit contenir au moins un caractère spécial (!@#$%^&*()_+-=[]{}|;:,.<>?)',
    ]);
  });
  it('reports every failing rule', () => {
    expect(validatePassword('')).toHaveLength(5);
  });
});

describe('apiUrl', () => {
  it('joins without a trailing slash', () => {
    expect(apiUrl('https://x.test/api/v1')).toBe('https://x.test/api/v1/auth/reset-password');
  });
  it('joins with a trailing slash', () => {
    expect(apiUrl('https://x.test/api/v1/')).toBe('https://x.test/api/v1/auth/reset-password');
  });
});

describe('describeResult', () => {
  it('maps 2xx to success', () => {
    expect(describeResult({ status: 204 })).toEqual({
      kind: 'success',
      messages: [
        "Mot de passe enregistré. Vous pouvez maintenant vous connecter dans l'application FFD Connect.",
      ],
    });
  });
  const filtered = (message: unknown) => ({
    statusCode: 400,
    timestamp: '2026-10-07T12:00:00.000Z',
    path: '/api/v1/auth/reset-password',
    method: 'POST',
    message,
  });
  it('lists the errors of a 400 body when present', () => {
    expect(describeResult({ status: 400, body: { errors: ['a', 'b'] } })).toEqual({
      kind: 'error',
      messages: ['a', 'b'],
    });
  });
  it('maps a rejected token to the invalid link message with hint', () => {
    const r = describeResult({
      status: 400,
      body: filtered('Token de réinitialisation invalide, expiré ou déjà utilisé'),
    });
    expect(r.kind).toBe('error');
    expect(r.linkInvalid).toBe(true);
    expect(r.messages).toEqual([
      "Ce lien est invalide, expiré ou déjà utilisé. Demandez un nouveau lien depuis l'application (« Mot de passe oublié »).",
    ]);
  });
  it('shows a policy rejection message as is', () => {
    const r = describeResult({
      status: 400,
      body: filtered('Le mot de passe ne respecte pas la politique de sécurité'),
    });
    expect(r.messages).toEqual(['Le mot de passe ne respecte pas la politique de sécurité']);
    expect(r.linkInvalid).toBeUndefined();
  });
  it('shows each item of a ValidationPipe message array', () => {
    const msgs = ['newPassword must be longer than or equal to 8 characters', 'x'];
    expect(describeResult({ status: 400, body: filtered(msgs) }).messages).toEqual(msgs);
  });
  it('falls back to the invalid link message without any message', () => {
    for (const body of [undefined, {}, { errors: 'no' }, filtered('')]) {
      const r = describeResult({ status: 400, body });
      expect(r.messages[0]).toMatch(/^Ce lien est invalide/);
      expect(r.linkInvalid).toBe(true);
    }
  });
  it('maps 429 to retry later', () => {
    const r = describeResult({ status: 429 });
    expect(r.kind).toBe('error');
    expect(r.messages[0]).toMatch(/Trop de tentatives/);
  });
  it('maps 5xx and network failures to server unavailable', () => {
    for (const r of [
      describeResult({ status: 503 }),
      describeResult({ status: 500 }),
      describeResult({ networkError: true }),
    ]) {
      expect(r.kind).toBe('error');
      expect(r.messages[0]).toMatch(/Serveur indisponible/);
    }
  });
});
