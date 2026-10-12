import { vi } from 'vitest';
import { columnPrefsKey, isColumnVisible, loadColumnPrefs, saveColumnPrefs } from './columnPrefs';

describe('column preferences', () => {
  afterEach(() => vi.restoreAllMocks());

  it('round-trips the choice of one table, apart from the others', () => {
    saveColumnPrefs('users', { email: false, lastLoginAt: true });
    expect(loadColumnPrefs('users')).toEqual({ email: false, lastLoginAt: true });
    expect(loadColumnPrefs('tracks')).toEqual({});
  });

  it('removes the entry when the choice is back to the defaults', () => {
    saveColumnPrefs('users', { email: false });
    saveColumnPrefs('users', {});
    expect(localStorage.getItem(columnPrefsKey('users'))).toBeNull();
  });

  it.each(['not json', '[1,2]', 'null', '"x"'])('falls back to the defaults on %s', (raw) => {
    localStorage.setItem(columnPrefsKey('users'), raw);
    expect(loadColumnPrefs('users')).toEqual({});
  });

  it('keeps only boolean entries', () => {
    localStorage.setItem(columnPrefsKey('users'), JSON.stringify({ email: false, club: 'yes' }));
    expect(loadColumnPrefs('users')).toEqual({ email: false });
  });

  it('falls back to the defaults when the storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(loadColumnPrefs('users')).toEqual({});
    expect(() => saveColumnPrefs('users', { email: false })).not.toThrow();
  });

  it('shows a column by its default unless the admin chose otherwise; never hides a required one', () => {
    expect(isColumnVisible({ key: 'email' }, {})).toBe(true);
    expect(isColumnVisible({ key: 'email' }, { email: false })).toBe(false);
    expect(isColumnVisible({ key: 'login', hiddenByDefault: true }, {})).toBe(false);
    expect(isColumnVisible({ key: 'login', hiddenByDefault: true }, { login: true })).toBe(true);
    expect(isColumnVisible({ key: 'name', required: true }, { name: false })).toBe(true);
  });
});
