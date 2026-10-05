# DESIGN.md — FFD-Connect Design System

The product is an app French dancers open every competition weekend. The design must feel **trustworthy** (it's the federation's tool: licenses, results, registrations) AND **alive** (the moment-of-use is on event day, in a venue, between heats — fast, dense, lively).

This file is the source of truth. Tokens live in `apps/client/src/theme/index.ts`.

## Voice

- Direct, useful, never marketing-fluff. "Inscriptions: J-3" not "Don't miss the deadline!"
- French is primary. Microcopy in French unless content is technical.
- Active voice. "Scanner ma licence" not "La licence sera scannée".
- Numbers shown plainly, no jargon. "12 inscrits" not "12 registrants on this event".

## Color

### Brand

| Token     | Hex       | Usage                                                                              |
| --------- | --------- | ---------------------------------------------------------------------------------- |
| `ffdBlue` | `#004481` | Federation identity — license cards, official badges, heading accents              |
| `ffdCyan` | `#0088CE` | App-side accent — interactive elements, primary buttons in dark mode, focus states |
| `ffdRed`  | `#E30613` | Status/urgency only — competition LIVE badge, deadline alerts, errors              |

**Rule:** the deep blue is the federation. The cyan is the app. When in doubt, use cyan for interaction and reserve blue for moments where the user needs to feel "this is the official tool" (license display, validated results).

### Neutrals (Slate)

11-step slate scale (50 → 950). Built around the FFD blue family — these are intentionally cool grays, not warm neutrals.

- Light theme: background = `slate50`, surface = `white`, text = `slate900`, border = `slate200`.
- Dark theme: background = `slate950`, surface = `slate900`, text = `slate50`, border = `slate800`.
- Secondary text always `slate500` (light) or `slate400` (dark).

### Semantic

| Token     | Hex                  | Use for                                              |
| --------- | -------------------- | ---------------------------------------------------- |
| `success` | `#10B981` (Emerald)  | Confirmation, registered status, validated check-in  |
| `warning` | `#F59E0B` (Amber)    | Deadline within 14 days, partial OCR, soft errors    |
| `danger`  | `#EF4444` (Soft red) | Hard errors, expired license, deadline within 3 days |

**Never** use `ffdRed` for warnings or errors — it's reserved for status (live badge, heat indicators). Errors use `danger`.

### Dark mode

Primary = `ffdCyan`, not `ffdBlue` — the deep blue is unreadable on dark surfaces. Surfaces use elevation (slate950 → slate900) not just lightness inversion. Body text `slate50`, never pure white (FOUT-y feeling).

### Don't

- No purple/violet anywhere. We have a blue. We don't need a purple gradient.
- No mixing warm grays. The slate is cool. Don't import a warm gray for "balance".
- No more than 2 brand colors visible in the same view. Cyan + blue + red on one screen = AI slop.

## Typography

**One family: DMSans.** Three weights: Bold (700), Medium (500), Regular (400).

| Style     | Family         | Size | Weight | Letter-spacing | Use                                    |
| --------- | -------------- | ---- | ------ | -------------- | -------------------------------------- |
| `h1`      | DMSans-Bold    | 32   | 700    | -0.5           | Screen titles only (one per screen)    |
| `h2`      | DMSans-Bold    | 24   | 700    | -0.5           | Section headers                        |
| `h3`      | DMSans-Medium  | 20   | 500    | 0              | Card titles, sub-sections              |
| `body`    | DMSans-Regular | 16   | 400    | 0              | All running text. line-height 24.      |
| `caption` | DMSans-Medium  | 13   | 500    | 0              | Labels, metadata, secondary info       |
| `button`  | DMSans-Medium  | 16   | 500    | +0.5           | Buttons (slight tracking for tap feel) |

**Rules:**

- Never go below 13px. Never above 32px.
- Numbers in tables/columns: use `fontVariant: ["tabular-nums"]` so they align.
- Never use `Inter`, `Roboto`, `system`. We picked DMSans for a reason — its slightly geometric feel matches the dance line of the brand.
- One H1 per screen. Skipping levels (h1 → h3) is forbidden.

## Spacing

10-step scale, multiples of 4:

| Token  | Value | Use for                                   |
| ------ | ----- | ----------------------------------------- |
| `xxs`  | 2     | Inline icon ↔ text, super-tight           |
| `xs`   | 4     | Within a single component (badge padding) |
| `s`    | 8     | Inside cards, between related items       |
| `sm`   | 12    | Between sub-elements in a card            |
| `m`    | 16    | Card padding, default gap                 |
| `md`   | 20    | Screen-level horizontal padding           |
| `l`    | 24    | Between cards, section gaps               |
| `xl`   | 32    | Section dividers                          |
| `xxl`  | 48    | Hero spacing, big breaks                  |
| `xxxl` | 64    | Reserved for marketing / landing only     |

**Rule:** every numeric value in `padding`, `margin`, `gap` MUST come from this scale. No magic numbers. If you need 14px, you're probably wrong — use 12 or 16.

## Border radius

| Token  | Value | Use for                                 |
| ------ | ----- | --------------------------------------- |
| `s`    | 6     | Tags, small badges                      |
| `m`    | 12    | Default for cards, buttons, inputs      |
| `l`    | 20    | Modals, big surfaces                    |
| `xl`   | 30    | Hero / "premium" cards only — sparingly |
| `full` | 9999  | Avatars, pills, FAB                     |

**Don't** use `xl` everywhere. Bubbly = AI slop.

## Elevation

4 levels. Use the `elevation[N]` token, never inline shadow.

| Level | When                                  |
| ----- | ------------------------------------- |
| `0`   | Flat surfaces, dividers               |
| `1`   | Default cards (subtle lift)           |
| `2`   | Hovered/pressed cards, sticky headers |
| `3`   | Modals, bottom sheets, dropdowns      |

iOS uses `shadowColor/Offset/Opacity/Radius`, Android uses `elevation`. Tokens combine both.

## Components

### AppButton

Variants: `primary` | `secondary` | `outline` | `ghost` | `danger`.

- `primary` — most actions. ffdBlue (light) / ffdCyan (dark).
- `secondary` — "submit a partner", non-destructive alternate path.
- `outline` — when on a colored background where solid would feel heavy.
- `ghost` — tertiary inline actions ("Annuler" next to "Confirmer").
- `danger` — destructive only ("Supprimer", "Désinscrire").

**Min touch target: 44pt height.** Always.

### AppText

The only text component. Always pass `variant="h1|h2|h3|body|caption|button"`. Never use raw `<Text>` — it bypasses the typography scale and you lose the family.

### Cards

- Default radius `m` (12).
- Default elevation `1`.
- Default padding `m` (16).
- Border `1px solid border` token (always present, even at elevation 0 — defines the edge crisply).

## Iconography

**Lucide React Native.** One icon set, no exceptions. No emoji as decoration. No mixed icon styles.

**Sizing:** 14, 16, 20, 24, 32. Never in between.

**Color:** stroke matches the surrounding text color (textSecondary by default, primary for accents).

## Motion

- Durations: 150ms (state changes), 250ms (entries), 350ms (page transitions). Never above 500ms.
- Easing: `ease-out` for entering, `ease-in` for exiting, `ease-in-out` for moving.
- Only animate `transform` and `opacity`. Never `width/height/top/left`.
- Respect `prefers-reduced-motion` (the OS toggle disables our animations).

## Layout

- Screen horizontal padding: `md` (20).
- Card-to-card gap: `m` (16) when stacked vertically.
- Safe area: respect notch/home bar via `react-native-safe-area-context`. Never hardcode top/bottom inset.

## Two-state competition card

Specific to the competitions feed:

- **UPCOMING**: date + deadline countdown (J-N badge if ≤14 days) + location + distance.
- **LIVE**: full venue address (primary color) + start time prominent + distance.
- **PAST**: date only, dim, no deadline/distance.

The card body changes based on status. This is intentional — what matters changes between "is this on my radar" (upcoming) and "where am I going right now" (live).

## What we never ship

- Purple gradients (anywhere)
- 3-column feature grids with icon-in-circle
- Centered everything
- Bubbly radius on every element
- Decorative blobs, floating SVG circles
- Emoji in headings
- Generic copy ("Welcome to FFD-Connect", "Your all-in-one dance solution")
- Cards used as decoration when they're not interactive
- More than 2 brand colors in the same view

## When in doubt

Open the LicenseScreen. Open the CompetitionsScreen. They're the spine. New screens should feel like they belong next to those two. If a new screen requires breaking a rule above, write it down here first with the why — the system evolves, but explicitly.
