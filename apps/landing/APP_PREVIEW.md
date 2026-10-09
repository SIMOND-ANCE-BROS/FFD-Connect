# FFD Connect website preview

Reference: SIMOND-ANCE-BROS/FFD-Connect, develop commit
`0e257a11b8f9e052a042f1f58e53d0c706daef64`, inspected 7 October 2026.

This is a standalone HTML/React adaptation of selected React Native screens.
It is not an Expo build, screenshot gallery, or live authenticated application.
The website and FAQ state this explicitly. No client account or API is connected.
The native application code is unchanged by this landing redesign.

## Source mapping

- `apps/client/src/theme/index.ts`: DM Sans, light slate background, royal blue,
  cyan, borders and semantic colours.
- `components/GlassHeader.tsx`, `FluidSegmentedTab.tsx`, `CurvedTabBar.tsx` and
  `navigation/MainTabs.tsx`: screen headings, gradient segmented controls,
  floating icon navigation and role-specific club navigation.
- `features/competitions/screens/CompetitionsScreen.tsx` and its stylesheet:
  search, scope, period controls, white cards, status/registration labels,
  dates and locations.
- `features/player/screens/LibraryScreen.tsx` and `components/library/*`:
  All/Dances/Favourites segments, two-column dance grid and track rows.
- `features/license/screens/LicenseScreen.tsx` and `components/license-card/*`:
  licence heading, blue card header, information/photo columns and footer.
- `features/club/screens/ClubDashboardScreen.tsx`: dashboard statistics,
  coloured module icons and management rows.

## Deliberate adaptations

All names, events, counts, dates and tracks are fixture data. Search, scope,
period and library family filters operate locally. Favourites stay in component
memory and reset on switching main modules or reloading. Dance cards open a
sample track list. Licence cards expand/collapse. Actions requiring an account,
backend or native capability open an explanatory accessible dialog.

No audio tracks, QR credential, registration, PDF sharing or real notifications
are generated. The pre-existing site metronome remains separately labelled as
an additional site tool, outside the application preview.

The phone frame/status bar is presentation chrome. Text adapts for browser
zoom and small screens. Dance initials are white for contrast; upstream uses
black. The supplied app mark is kept in colour instead of applying the native
white tint. The licence season uses white for contrast instead of source red.
The demo's WDSF invitation explains the feature without importing a real licence.

## Assets

- `public/app-logo.png`: user's previously generated 512 × 512 app icon.
- `public/app-presentation.png`: user's previously generated 1024 × 500 image.
- `public/license-source-logo.png`: original `apps/client/src/assets/logo.png`
  from the pinned upstream commit, used within the licence card.

## Competition journey (8 October 2026)

The detail screen, information card and Events / Timing tabs are adapted from
commit `70036b30f98327f30c90ebf57edd8f7eb01d564c`: `CompetitionDetailScreen`,
`CompetitionInfoCard` and `CompetitionProgramSection`. Dates, venues, schedule
and organizer are fixtures. There is no real registration or live data. Maps
and external documents are not simulated. Returning preserves filters and
restores focus to the selected card. On mobile, the preview precedes its
explanatory copy. Other screens use the pinned reference above; this is not
a promise of pixel parity with later mobile releases.
