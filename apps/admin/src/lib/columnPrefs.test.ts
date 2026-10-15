import { vi } from 'vitest';
import {
  type ColumnPrefs,
  columnPrefsKey,
  DEFAULT_COLUMN_PREFS,
  dropKey,
  isColumnVisible,
  loadColumnPrefs,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  moveKey,
  orderColumns,
  saveColumnPrefs,
} from './columnPrefs';

const prefs = (patch: Partial<ColumnPrefs>): ColumnPrefs => ({ ...DEFAULT_COLUMN_PREFS, ...patch });

describe('column preferences', () => {
  afterEach(() => vi.restoreAllMocks());

  it('round-trips the choice, widths and order of one table, apart from the others', () => {
    const chosen = prefs({
      visible: { email: false, lastLoginAt: true },
      widths: { name: 240 },
      order: ['email', 'name'],
    });
    saveColumnPrefs('users', chosen);
    expect(loadColumnPrefs('users')).toEqual(chosen);
    expect(loadColumnPrefs('tracks')).toEqual(DEFAULT_COLUMN_PREFS);
  });

  it('stores only what differs from the defaults, and nothing once back to them', () => {
    saveColumnPrefs('users', prefs({ widths: { name: 240 } }));
    expect(JSON.parse(localStorage.getItem(columnPrefsKey('users')) ?? '{}')).toEqual({
      widths: { name: 240 },
    });
    saveColumnPrefs('users', DEFAULT_COLUMN_PREFS);
    expect(localStorage.getItem(columnPrefsKey('users'))).toBeNull();
  });

  it('reads the visibility map stored before widths and order existed (#444)', () => {
    localStorage.setItem(columnPrefsKey('users'), JSON.stringify({ email: false, club: 'yes' }));
    expect(loadColumnPrefs('users')).toEqual(prefs({ visible: { email: false } }));
  });

  it.each(['not json', '[1,2]', 'null', '"x"'])('falls back to the defaults on %s', (raw) => {
    localStorage.setItem(columnPrefsKey('users'), raw);
    expect(loadColumnPrefs('users')).toEqual(DEFAULT_COLUMN_PREFS);
  });

  it('drops corrupt parts and clamps widths into their bounds', () => {
    localStorage.setItem(
      columnPrefsKey('users'),
      JSON.stringify({
        visible: { email: false, club: 1 },
        widths: { name: 5, email: 99999, club: 'wide', role: 150.4 },
        order: ['name', 'name'],
      }),
    );
    expect(loadColumnPrefs('users')).toEqual(
      prefs({
        visible: { email: false },
        widths: { name: MIN_COLUMN_WIDTH, email: MAX_COLUMN_WIDTH, role: 150 },
      }),
    );
    localStorage.setItem(columnPrefsKey('users'), JSON.stringify({ order: ['a', 3] }));
    expect(loadColumnPrefs('users').order).toEqual([]);
  });

  it('falls back to the defaults when the storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(loadColumnPrefs('users')).toEqual(DEFAULT_COLUMN_PREFS);
    expect(() => saveColumnPrefs('users', prefs({ visible: { email: false } }))).not.toThrow();
  });

  it('shows a column by its default unless the admin chose otherwise; never hides a required one', () => {
    expect(isColumnVisible({ key: 'email' }, prefs({}))).toBe(true);
    expect(isColumnVisible({ key: 'email' }, prefs({ visible: { email: false } }))).toBe(false);
    expect(isColumnVisible({ key: 'login', hiddenByDefault: true }, prefs({}))).toBe(false);
    expect(
      isColumnVisible({ key: 'login', hiddenByDefault: true }, prefs({ visible: { login: true } })),
    ).toBe(true);
    expect(
      isColumnVisible({ key: 'name', required: true }, prefs({ visible: { name: false } })),
    ).toBe(true);
  });
});

describe('column order (#671)', () => {
  const columns = ['a', 'b', 'c', 'd'].map((key) => ({ key }));
  const keys = (list: { key: string }[]) => list.map((c) => c.key);

  it('follows the stored order, keeps a new column at its default place, ignores a removed one', () => {
    expect(keys(orderColumns(columns, []))).toEqual(['a', 'b', 'c', 'd']);
    expect(keys(orderColumns(columns, ['d', 'c', 'b', 'a']))).toEqual(['d', 'c', 'b', 'a']);
    expect(keys(orderColumns(columns, ['c', 'gone', 'a']))).toEqual(['c', 'b', 'a', 'd']);
  });

  it('moves a key up or down, clamped to the ends', () => {
    expect(moveKey(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveKey(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(moveKey(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveKey(['a', 'b', 'c'], 'x', 1)).toEqual(['a', 'b', 'c']);
  });

  it('drops a key before or after another', () => {
    expect(dropKey(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
    expect(dropKey(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
    expect(dropKey(['a', 'b', 'c'], 'a', 'a', 'after')).toEqual(['a', 'b', 'c']);
    expect(dropKey(['a', 'b', 'c'], 'x', 'a', 'after')).toEqual(['a', 'b', 'c']);
  });
});
