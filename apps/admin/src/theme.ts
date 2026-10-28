import {
  Alert,
  type CSSVariablesResolver,
  createTheme,
  type MantineColorsTuple,
  Modal,
  Paper,
  Table,
  Card,
  Badge,
  Checkbox,
  defaultVariantColorsResolver,
  parseThemeColor,
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
  // Links and light-variant text in the dark scheme: 5.1:1 on the dark surfaces.
  '#5a9edb',
  '#2479c9',
  BRAND.cyan,
  '#0058a6',
  BRAND.blue,
  '#003464',
];

/** Families whose dark-scheme fill (shade 6) needs dark text. */
const INK_ON_FILL = new Set(['ffd', 'blue', 'green', 'orange', 'yellow']);

// Amber, the app's warning family (pending, temporary).
const amber: MantineColorsTuple = [
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
    // Mantine's own blue and yellow are not in the app palette and fail
    // contrast as light badges and alert titles: statuses map to the FFD blue
    // and to the amber family.
    blue: ffdBlue,
    yellow: amber,
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
    orange: amber,
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
  // Mantine picks the text of a filled control from the light-scheme shade
  // only: in the dark scheme the cyan, emerald and amber fills kept white
  // text (3.2-3.9:1). Their text comes from a per-scheme variable instead.
  variantColorResolver: (input) => {
    const colors = defaultVariantColorsResolver(input);
    if (input.variant !== 'filled') return colors;
    const { color } = parseThemeColor({
      color: input.color ?? input.theme.primaryColor,
      theme: input.theme,
    });
    return INK_ON_FILL.has(color)
      ? { ...colors, color: `var(--app-on-filled-${color}, ${colors.color})` }
      : colors;
  },
  black: BRAND.slate950,
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
      // Statuses are read in dense tables: 13 px at the default size (Mantine
      // ships 11 px), never under 12 px (DESIGN.md text floor).
      vars: (_theme, props) => {
        if (props.size === undefined || props.size === 'md') {
          return { root: { '--badge-fz': '0.8125rem', '--badge-height': '1.375rem' } };
        }
        if (props.size === 'sm' || props.size === 'xs') {
          return { root: { '--badge-fz': '0.75rem', '--badge-height': '1.25rem' } };
        }
        return { root: {} };
      },
    }),
    // Long notices keep a readable measure on wide screens.
    Alert: Alert.extend({ styles: { message: { maxWidth: '80ch' } } }),
    Table: Table.extend({
      defaultProps: { verticalSpacing: 'sm', horizontalSpacing: 'md' },
      styles: { th: { fontWeight: 600, whiteSpace: 'nowrap' } },
    }),
    Modal: Modal.extend({ defaultProps: { radius: 'md' } }),
    // The md default radius makes checkboxes round, read as radio buttons
    // (single choice): a multiple choice keeps square boxes.
    Checkbox: Checkbox.extend({ defaultProps: { radius: 'xs' } }),
  },
});

/** App-level surfaces the Mantine palette has no name for. */
export const cssVariablesResolver: CSSVariablesResolver = () => {
  const onFilled = (ink: string) =>
    Object.fromEntries([...INK_ON_FILL].map((c) => [`--app-on-filled-${c}`, ink]));
  return {
    variables: {},
    light: {
      '--app-canvas': BRAND.slate50,
      '--app-header-bg': BRAND.blue,
      // Shade 8 fills (light scheme): white text, 6-10:1.
      ...onFilled('var(--mantine-color-white)'),
    },
    dark: {
      '--app-canvas': BRAND.slate950,
      '--app-header-bg': '#0b1324',
      // Shade 6 fills (dark scheme): slate ink, 5.2-6.3:1 (white is 3.2-3.9:1).
      ...onFilled('var(--mantine-color-black)'),
    },
  };
};
