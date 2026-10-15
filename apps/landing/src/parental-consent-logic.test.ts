import { describe, expect, it } from 'vitest';
import {
  apiUrl,
  describeOutcome,
  formatDate,
  viewForLink,
  type LinkView,
} from './parental-consent-logic';

const link: LinkView = {
  childFirstName: 'Léa',
  state: 'PENDING',
  expiresAt: '2026-10-22T10:00:00.000Z',
  grantedAt: null,
  revokedAt: null,
};

describe('parental consent page logic (#61)', () => {
  it('builds the API URLs', () => {
    expect(apiUrl('https://api.example/api/v1/', 'confirm')).toBe(
      'https://api.example/api/v1/parental-consent/confirm',
    );
    expect(apiUrl('https://api.example/api/v1', 'lookup')).toBe(
      'https://api.example/api/v1/parental-consent/lookup',
    );
  });

  it('formats dates in French, Paris time', () => {
    expect(formatDate('2026-10-22T10:00:00.000Z')).toBe('22 octobre 2026');
    expect(formatDate(null)).toBe('');
    expect(formatDate('nope')).toBe('');
  });

  it('offers both answers on a pending link, and says what consent covers', () => {
    const view = viewForLink(link);
    expect(view.panel).toBe('pending');
    expect(view.canConfirm).toBe(true);
    expect(view.canRevoke).toBe(true);
    expect(view.title).toContain('Léa');
    expect(view.lines.join(' ')).toContain('certificat médical');
    expect(view.lines.join(' ')).toContain('22 octobre 2026');
  });

  it('offers the withdrawal once granted', () => {
    const view = viewForLink({
      ...link,
      state: 'GRANTED',
      grantedAt: '2026-10-16T08:00:00.000Z',
    });
    expect(view).toMatchObject({ panel: 'granted', canConfirm: false, canRevoke: true });
    expect(view.lines[0]).toContain('16 octobre 2026');
  });

  it('offers nothing more once withdrawn', () => {
    const view = viewForLink({ ...link, state: 'REVOKED', revokedAt: '2026-10-17T08:00:00Z' });
    expect(view).toMatchObject({ panel: 'revoked', canConfirm: false, canRevoke: false });
    expect(view.lines[0]).toContain('17 octobre 2026');
    expect(viewForLink({ ...link, state: 'REVOKED' }).lines[0]).toBe(
      'Votre accord pour le compte de Léa a été retiré.',
    );
  });

  it('lets an expired link still refuse, never confirm', () => {
    const view = viewForLink({ ...link, state: 'EXPIRED' });
    expect(view).toMatchObject({ panel: 'expired', canConfirm: false, canRevoke: true });
  });

  it('never prints an empty first name', () => {
    expect(viewForLink({ ...link, childFirstName: '  ' }).title).toBe(
      'Accord pour le compte de votre enfant',
    );
  });

  describe('describeOutcome', () => {
    it('renders a successful answer', () => {
      expect(describeOutcome({ status: 200, body: link }).panel).toBe('pending');
    });

    it('treats an unexpected body as unavailable', () => {
      expect(describeOutcome({ status: 200, body: { state: 'WHAT' } }).panel).toBe('error');
      expect(describeOutcome({ status: 200, body: null }).panel).toBe('error');
    });

    it("shows the backend's 400 message (string or list)", () => {
      expect(
        describeOutcome({ status: 400, body: { message: 'Ce lien a expiré.' } }).lines,
      ).toEqual(['Ce lien a expiré.']);
      expect(describeOutcome({ status: 400, body: { message: ['a', 2, 'b'] } }).lines).toEqual([
        'a',
        'b',
      ]);
      expect(describeOutcome({ status: 400, body: { message: [] } }).lines[0]).toContain(
        'invalide',
      );
      expect(describeOutcome({ status: 400 }).lines[0]).toContain('invalide');
    });

    it('handles throttling, server errors and the network', () => {
      expect(describeOutcome({ status: 429 }).lines[0]).toContain('Trop de tentatives');
      expect(describeOutcome({ status: 503 }).lines[0]).toContain('indisponible');
      expect(describeOutcome({ networkError: true }).lines[0]).toContain('indisponible');
    });
  });
});
