import { EXPANDER_WIDTH, type FitColumn, fitColumns } from './tableFit';

const col = (key: string, extra: Partial<FitColumn> = {}): FitColumn => ({
  key,
  minWidth: 100,
  weight: 1,
  priority: 0,
  pinned: false,
  ...extra,
});

const sum = (widths: Record<string, string>, expander: string | null) =>
  Object.values(widths)
    .concat(expander ?? '0%')
    .reduce((total, w) => total + Number.parseFloat(w), 0);

describe('fitColumns', () => {
  it('keeps every column and splits by weight while unmeasured', () => {
    const fit = fitColumns([col('a', { weight: 3 }), col('b')], 0);
    expect(fit.shown).toEqual(['a', 'b']);
    expect(fit.hidden).toEqual([]);
    expect(fit.widths).toEqual({ a: '75%', b: '25%' });
    expect(fit.expanderWidth).toBeNull();
  });

  it('keeps every column when their minimums fit, sharing the spare width by weight', () => {
    // 1000 px: 300 px of minimums, 700 px spare split between a and b → 450 + 450 + 100.
    const fit = fitColumns([col('a'), col('b'), col('c', { weight: 0 })], 1000);
    expect(fit.shown).toEqual(['a', 'b', 'c']);
    expect(fit.hidden).toEqual([]);
    expect(fit.widths).toEqual({ a: '45%', b: '45%', c: '10%' });
    expect(sum(fit.widths, fit.expanderWidth)).toBeCloseTo(100, 1);
  });

  it('moves the least important columns out first, keeping the original order', () => {
    const columns = [
      col('name', { pinned: true }),
      col('email', { priority: 1 }),
      col('role', { priority: 3 }),
      col('club', { priority: 2 }),
    ];
    // Room for 3 columns once the expander is served.
    const fit = fitColumns(columns, 300 + EXPANDER_WIDTH);
    expect(fit.shown).toEqual(['name', 'email', 'club']);
    expect(fit.hidden).toEqual(['role']);
    expect(fit.expanderWidth).not.toBeNull();
    expect(sum(fit.widths, fit.expanderWidth)).toBeCloseTo(100, 1);
  });

  it('skips a wide column to keep a narrower, less important one that still fits', () => {
    const columns = [
      col('name', { pinned: true }),
      col('detail', { priority: 1, minWidth: 400 }),
      col('date', { priority: 2 }),
    ];
    const fit = fitColumns(columns, 250 + EXPANDER_WIDTH);
    expect(fit.shown).toEqual(['name', 'date']);
    expect(fit.hidden).toEqual(['detail']);
  });

  it('never moves a pinned column out, even past its priority', () => {
    const columns = [
      col('a', { priority: 0 }),
      col('b', { priority: 1 }),
      col('c', { priority: 9, pinned: true }),
    ];
    const fit = fitColumns(columns, 200 + EXPANDER_WIDTH);
    expect(fit.shown).toEqual(['a', 'c']);
    expect(fit.hidden).toEqual(['b']);
  });

  it('breaks priority ties by position', () => {
    const fit = fitColumns([col('a'), col('b'), col('c')], 200 + EXPANDER_WIDTH);
    expect(fit.shown).toEqual(['a', 'b']);
  });

  it('keeps the pinned columns on a container too narrow for them, by their minimums', () => {
    const fit = fitColumns([col('a', { pinned: true }), col('b', { pinned: true }), col('c')], 150);
    expect(fit.shown).toEqual(['a', 'b']);
    expect(fit.hidden).toEqual(['c']);
    expect(sum(fit.widths, fit.expanderWidth)).toBeCloseTo(100, 1);
  });
});
