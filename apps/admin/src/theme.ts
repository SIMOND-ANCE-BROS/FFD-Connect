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
 * scheme (the app's dark primary), slate neutrals and semantic status colours.
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
  BRAND.cyan,
  '#0058a6',
  BRAND.blue,
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
  colors: {
    ffd: ffdBlue,
    gray: slate,
    dark: slateDark,
    // Emerald, amber and red families match the app's semantic palette.
    green: [
      '#ecfdf5',
      '#d1fae5',
      '#a7f3d0',
      '#6ee7b7',
      '#34d399',
      '#10B981',
      '#059669',
      '#047857',
      '#065f46',
      '#064e3b',
    ],
    orange: [
      '#fffbeb',
      '#fef3c7',
      '#fde68a',
      '#fcd34d',
      '#fbbf24',
      '#F59E0B',
      '#d97706',
      '#b45309',
      '#92400e',
      '#78350f',
    ],
    red: [
      '#fef2f2',
      '#fee2e2',
      '#fecaca',
      '#fca5a5',
      '#f87171',
      '#EF4444',
      '#dc2626',
      '#b91c1c',
      '#991b1b',
      '#7f1d1d',
    ],
  },
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
  autoContrast: true,
  radius: {
    xs: '0.25rem',
    sm: '0.375rem',
    md: '0.75rem',
    lg: '1.25rem',
    xl: '1.875rem',
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
  variables: {},
  light: {
    '--app-canvas': BRAND.slate50,
    '--app-header-bg': BRAND.blue,
  },
  dark: {
    '--app-canvas': BRAND.slate950,
    '--app-header-bg': '#0b1324',
  },
});
