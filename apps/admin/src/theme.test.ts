import { BRAND, cssVariablesResolver, theme } from './theme';

describe('admin theme', () => {
  it('uses the mobile cyan in dark mode with automatic foreground contrast', () => {
    expect(theme.colors?.ffd?.[6]).toBe(BRAND.cyan);
    expect(theme.autoContrast).toBe(true);
  });

  it('keeps badges in sentence case on every variant and size (Mantine uppercases by default)', () => {
    const styles = theme.components?.Badge?.styles as {
      label?: { textTransform?: string };
    };
    expect(styles.label?.textTransform).toBe('none');
  });

  it('gives the dark-scheme cyan, emerald and amber fills dark text, white in light', () => {
    const vars = cssVariablesResolver(theme as never);
    expect(vars.light['--app-on-filled-ffd']).toBe('var(--mantine-color-white)');
    expect(vars.dark['--app-on-filled-ffd']).toBe('var(--mantine-color-black)');
    expect(vars.dark['--app-on-filled-green']).toBe('var(--mantine-color-black)');
    expect(vars.dark['--app-on-filled-red']).toBeUndefined();
    expect(theme.black).toBe(BRAND.slate950);
  });

  it('maps Mantine blue and yellow statuses to the app palette', () => {
    expect(theme.colors?.blue).toBe(theme.colors?.ffd);
    expect(theme.colors?.yellow).toBe(theme.colors?.orange);
  });

  it('uses the federation blue as primary in light mode', () => {
    expect(theme.primaryColor).toBe('ffd');
    expect(theme.colors?.ffd?.[8]).toBe('#004481');
    expect(theme.primaryShade).toEqual({ light: 8, dark: 6 });
  });
});
