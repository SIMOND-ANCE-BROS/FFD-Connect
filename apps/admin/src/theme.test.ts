import { BRAND, theme } from './theme';

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

  it('uses the federation blue as primary in light mode', () => {
    expect(theme.primaryColor).toBe('ffd');
    expect(theme.colors?.ffd?.[8]).toBe('#004481');
    expect(theme.primaryShade).toEqual({ light: 8, dark: 6 });
  });
});
