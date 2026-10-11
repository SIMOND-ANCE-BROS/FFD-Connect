import { theme } from './theme';

describe('admin theme', () => {
  it('keeps badges in sentence case on every variant and size (Mantine uppercases by default)', () => {
    const styles = theme.components?.Badge?.styles as { label?: { textTransform?: string } };
    expect(styles.label?.textTransform).toBe('none');
  });

  it('uses the federation blue as primary in light mode', () => {
    expect(theme.primaryColor).toBe('ffd');
    expect(theme.colors?.ffd?.[8]).toBe('#004481');
    expect(theme.primaryShade).toEqual({ light: 8, dark: 6 });
  });
});
