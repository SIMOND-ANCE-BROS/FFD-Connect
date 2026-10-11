import {
  type CSSVariablesResolver,
  createTheme,
  type MantineColorsTuple,
  Modal,
  Paper,
  Table,
  Card,
  Badge,
} from '@mantine/core';

/**
 * Back-office identity, aligned with the mobile app (apps/client/src/theme):
 * FFD royal blue as primary (the app's light primary), FFD cyan for the dark
 * scheme (the app's dark primary), FFD red as the single accent, slate neutrals.
 */
export const BRAND = {
  blue: '#004481',
  cyan: '#0088CE',
  red: '#E30613',
  slate50: '#F8FAFC',
  slate950: '#020617',
} as const;

// Shade 8 is the federation blue; lighter shades move towards the app's cyan.
const ffdBlue: MantineColorsTuple = [
  '#e7f2fb',
  '#cfe3f4',
  '#9fc6e9',
  '#6ba6dd',
  '#3f8ad2',
  '#2479c9',
  '#0f6bbf',
  '#0058a6',
  '#004481',
  '#003464',
];

// Tailwind slate, as in the app: light greys of the UI and dark surfaces.
const slate: MantineColorsTuple = [
  '#f8fafc',
  '#f1f5f9',
  '#e2e8f0',
  '#cbd5e1',
  '#94a3b8',
  '#64748b',
  '#475569',
  '#334155',
  '#1e293b',
  '#0f172a',
];

// Mantine's dark scale reads from light text (0) to the darkest surface (9).
const slateDark: MantineColorsTuple = [
  '#e2e8f0',
  '#cbd5e1',
  '#94a3b8',
  '#64748b',
  '#475569',
  '#334155',
  '#1e293b',
  '#0f172a',
  '#0b1324',
  '#020617',
];

const fontFamily =
  "'DM Sans Variable', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export const theme = createTheme({
  primaryColor: 'ffd',
  primaryShade: { light: 8, dark: 6 },
  colors: { ffd: ffdBlue, gray: slate, dark: slateDark },
  fontFamily,
  headings: {
    fontFamily,
    fontWeight: '650',
    sizes: {
      h2: { fontSize: '1.5rem', lineHeight: '1.25' },
      h3: { fontSize: '1.2rem', lineHeight: '1.3' },
      h4: { fontSize: '1.05rem', lineHeight: '1.35' },
    },
  },
  defaultRadius: 'md',
  cursorType: 'pointer',
  focusRing: 'auto',
  components: {
    Paper: Paper.extend({ defaultProps: { radius: 'md' } }),
    Card: Card.extend({ defaultProps: { radius: 'md', padding: 'md' } }),
    // Sentence-case badges: statuses read as words, not shouted labels.
    Badge: Badge.extend({
      defaultProps: { radius: 'sm' },
      styles: { label: { textTransform: 'none', fontWeight: 600 } },
    }),
    Table: Table.extend({
      defaultProps: { verticalSpacing: 'sm', horizontalSpacing: 'md' },
      styles: { th: { fontWeight: 600, whiteSpace: 'nowrap' } },
    }),
    Modal: Modal.extend({ defaultProps: { radius: 'md' } }),
  },
});

/** App-level surfaces the Mantine palette has no name for. */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  // The red rule under the header band: the one accent of the interface.
  variables: { '--app-accent': BRAND.red },
  light: {
    '--app-canvas': BRAND.slate50,
    '--app-header-bg': BRAND.blue,
  },
  dark: {
    '--app-canvas': BRAND.slate950,
    '--app-header-bg': '#0b1324',
  },
});
