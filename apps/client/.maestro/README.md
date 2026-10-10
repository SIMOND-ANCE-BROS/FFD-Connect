# Maestro E2E Tests

[Maestro](https://maestro.mobile.dev/) end-to-end flows for the FFD Connect mobile app —
drive the app on an iOS simulator **as a real user, one login flow per role**.

## Prerequisites

- Maestro CLI (`curl -Ls "https://get.maestro.mobile.dev" | bash`) — needs Java; use the
  Android Studio JBR: `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`.
- **Node 22** (`.nvmrc`) — under Node ≥ 26 some RN tests fail spuriously.
- App bundle ID (dev/standalone): **`fr.ffdanse.connect`**.

## 1. Backend + seeded profiles

```bash
docker compose --profile infra up -d      # Postgres + Redis
pnpm --filter backend start:dev           # API on :3000
pnpm --filter backend seed:e2e            # one account per role (idempotent)
```

`seed:e2e` creates the QA profiles, all with password **`TestE2e123!`**:

| Role     | Login                           | Bottom-tab set                                              |
| -------- | ------------------------------- | ----------------------------------------------------------- |
| Guest    | _"Continuer en tant qu'invité"_ | Compétitions · Réglages                                     |
| LICENSEE | `test.e2e@ffd.com`              | Carrière · License · Bibliothèque · Compétitions · Réglages |
| CLUB     | `club.e2e@ffd.com`              | Espace club · Compétitions · Scanner · Réglages             |
| STAFF    | `staff.e2e@ffd.com`             | Compétitions · Scanner · Réglages                           |
| ADMIN    | `admin.e2e@ffd.com`             | Bibliothèque · Compétitions · Scanner · Réglages            |

## 2. Standalone build (the reliable vehicle — NOT the dev-client)

The dev-client breaks automation (bundle reloads, deep-link dialog). Build a **standalone
Release** pointed at the local backend:

```bash
cd apps/client
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 \
EXPO_PUBLIC_LOCAL_IP=localhost EXPO_PUBLIC_APP_ENV=development \
EXPO_PUBLIC_API_URL=http://localhost:3000/api/v1 SENTRY_DISABLE_AUTO_UPLOAD=true \
EXPO_PUBLIC_DISABLE_SENTRY=1 EXPO_PUBLIC_DEBUG_BOOT=1 \
pnpm exec expo run:ios --configuration Release --device "iPhone 17 Pro"
```

> ⚠️ **`EXPO_PUBLIC_DISABLE_SENTRY=1` is mandatory on the iOS 26 simulator.** With Sentry
> enabled, a standalone Release build hangs forever on the splash at cold boot (the native
> Sentry SDK wedges the JS thread before the first render). It boots fine in dev and on real
> TestFlight devices, so this is a simulator-only QA workaround, not a production change.
> `EXPO_PUBLIC_DEBUG_BOOT=1` shows a small "App OK" banner once the React root mounts —
> handy to confirm the boot actually got past the splash.

## 3. Run flows

> Requires **Maestro ≥ 2.7.0** (the flows use `retry`, `runFlow when:`, and
> `hideKeyboard: { optional: true }`; the runner uses `--no-reinstall-driver`).

The standard way to run anything is the runner — one flow, a list, or the full sweep:

```bash
.maestro/run-suite.sh                    # all 28 feature flows
.maestro/run-suite.sh licensee-library   # a single flow
ATTEMPTS=2 REBOOT_EVERY=8 .maestro/run-suite.sh   # tune retries / proactive reboot
```

It prints `PASS/FAIL <flow> (attempt N)` per flow and a final tally, and exits non-zero if
any flow fails after all attempts. What it protects you from (all learned the hard way):

- **The iOS 26 sim input-pipeline wedge**: after many cold boots the sim ACKs taps that
  never reach the app (frozen status-bar clock in failure screenshots). Recovery reboots
  the sim on wedge signatures and proactively every `REBOOT_EVERY` flows.
- **Half-dead XCUITest driver**: alive for the reuse ping but erroring (HTTP 500) on real
  requests — and Maestro 2.7.0 can hang forever instead of exiting. A hard per-invocation
  watchdog (`INVOCATION_TIMEOUT`, default 600s) kills it and recovery takes over.
- **Dead backend / full disk**: fails fast with a message instead of 24 identical login
  failures; purges Maestro's per-step failure artifacts (gigabytes) older than a day.

### Speed: session reuse per role

Feature flows don't pay `clearState` + CGU + UI login each: their preamble is
`runFlow: ensure-<role>.yaml`, which relaunches the app (fresh process, ~10s) and reuses
the logged-in session when it already matches the role — falling back to the full
`reset-login-<role>.yaml` (clearState + CGU + login) only on role change or logged-out
state. Role detection uses the bottom-tab markers (STAFF/ADMIN need two conditions since
their tab sets overlap — see the comments in `ensure-staff.yaml`). Fewer cold boots also
means far fewer sim wedges. The `auth-*` flows keep full `clearState` preambles on purpose
(they test the logged-out paths). Full sweep: ~45 min on an Intel Mac, everything at
attempt 1; next lever if needed is sharding across 2 sims (`--shard-split`, Maestro 2.6+).

Per-role tag sessions (`maestro test .maestro/ --include-tags=licensee`) still work but
share one XCUITest driver across flows, which is exactly what goes zombie on this stack
(maestro#3254/#3318) — prefer the runner.

## Canonical login/logout flows

| File                  | Description                             |
| --------------------- | --------------------------------------- |
| `login-licensee.yaml` | Log in as LICENSEE (`test.e2e@ffd.com`) |
| `login-club.yaml`     | Log in as CLUB (`club.e2e@ffd.com`)     |
| `login-staff.yaml`    | Log in as STAFF (`staff.e2e@ffd.com`)   |
| `login-admin.yaml`    | Log in as ADMIN (`admin.e2e@ffd.com`)   |
| `logout.yaml`         | Log out from any authenticated screen   |

These are id-based (`login-email-input` / `login-password-input` / `login-submit-button`)
and use `eraseText` before typing — **required** to defeat iOS credential autofill, which
otherwise re-injects the last saved login.

## Feature flows (id-based, one per screen/path)

Each is self-contained: `retry { runFlow: ensure-<role>.yaml }` (session reuse, see §3)
→ navigate + assert. Run any of them directly against the standalone build — the ensure
preamble handles whatever state the sim is in.

Known iOS a11y limits (don't "fix" these back): SearchBars inside animated PinnedHeaders
(`club-members-search`, `club-solo-teams-search`) are not exposed to the Maestro 2.7
hierarchy — those flows assert a list row / the create FAB instead.

**Auth / entry** (no login)

| File                        | Path covered                                 |
| --------------------------- | -------------------------------------------- |
| `auth-guest.yaml`           | "Continuer en tant qu'invité" → Competitions |
| `auth-login-invalid.yaml`   | Wrong password → "Échec" error               |
| `auth-forgot-password.yaml` | Forgot-password link → email → submit        |
| `auth-register-form.yaml`   | Register link → form fields render           |

**LICENSEE**

| File                                 | Path covered                                   |
| ------------------------------------ | ---------------------------------------------- |
| `licensee-competitions.yaml`         | Status tabs, scope, search, open a detail      |
| `licensee-competitions-filters.yaml` | Filter sheet: style/discipline/distance        |
| `licensee-career.yaml`               | Partenariats / Résultats + member search       |
| `licensee-license.yaml`              | E-licence card (QR) + WDSF add                 |
| `licensee-library.yaml`              | Tabs (Tout/Danses/Favoris), search, MPM filter |
| `licensee-audio-player.yaml`         | Open a track → transport + BPM controls        |
| `licensee-performance-mode.yaml`     | Performance mode entry                         |
| `licensee-settings.yaml`             | Theme, animations, legal pages, tech info      |
| `licensee-change-password.yaml`      | Change-password form                           |
| `licensee-rgpd.yaml`                 | Data export + delete-account modal (cancel)    |
| `licensee-notifications.yaml`        | Notifications screen                           |
| `licensee-report-bug.yaml`           | "Faire un retour" (bug/feature report)         |

**CLUB**

| File                      | Path covered                                       |
| ------------------------- | -------------------------------------------------- |
| `club-dashboard.yaml`     | Dashboard overview + management rows               |
| `club-members.yaml`       | Members list, search, add-member editor            |
| `club-couples.yaml`       | Couples management                                 |
| `club-solo-teams.yaml`    | Solo Teams management                              |
| `club-competitions.yaml`  | Own competitions → create editor (tabs, add event) |
| `club-registrations.yaml` | Registrations list                                 |

**STAFF**

| File                      | Path covered                           |
| ------------------------- | -------------------------------------- |
| `staff-scanner.yaml`      | Scanner tab (camera N/A on simulator)  |
| `staff-competitions.yaml` | All competitions → detail              |
| `staff-live-results.yaml` | Live results (in-progress competition) |

**ADMIN**

| File                            | Path covered                             |
| ------------------------------- | ---------------------------------------- |
| `admin-library-moderation.yaml` | Library + add-track editor               |
| `admin-impersonation.yaml`      | "Se connecter en tant que" from settings |
| `admin-scanner.yaml`            | Scanner access                           |

Data-dependent steps (opening a specific competition card, a club member, playing a track)
use `optional: true` so a flow still passes on an empty DB — it verifies navigation +
rendering. Seed richer data with `pnpm --filter backend prisma db seed` (competitions) and
`SEED_TEST_TRACKS=true` (library) if you want those steps to exercise real content.

## Debugging

```bash
maestro studio                                  # interactive
maestro hierarchy                               # dump addressable selectors
maestro test .maestro/login-staff.yaml --debug-output ./debug-output
```
