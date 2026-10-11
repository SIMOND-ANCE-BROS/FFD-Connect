# FFD Connect — Landing and documentation

Vite/React landing deployed to GitHub Pages. Existing beta, legal and password-reset
routes are retained. See [APP_PREVIEW.md](APP_PREVIEW.md) for app screen references
and [ASSETS.md](ASSETS.md) for image/font credits.

## Development

```sh
pnpm install --frozen-lockfile --filter landing...
pnpm --filter landing dev
pnpm --filter landing lint
pnpm --filter landing test
pnpm --filter landing build
node apps/landing/scripts/check-documentation.mjs
```

`BASE_PATH` defaults to `/`; set `/FFD-Connect/` for project-site hosting.
`VITE_API_URL` is used by the existing password-reset page. Documentation and
the app preview do not call the backend or require GitHub credentials.

## Automatic documentation

The repository is the source of truth. Add or edit a Markdown file in `docs/`,
open a PR against `develop`, and use the normal promotion to `staging`.
The `Deploy landing (GitHub Pages)` workflow automatically rebuilds and publishes
the site when the change reaches `staging`. A PR validates the build but does
not publish it. No second copy of article content or manual navigation entry is needed.

For example, `docs/guides/ma-licence.md` becomes
`/documentation/guides/ma-licence/`. Its first H1 supplies the page title.
The article appears in the searchable directory automatically; H2 headings
populate its table of contents. Relative links to published Markdown files
are rewritten to site URLs. Folder `README.md` files become folder routes.

The generator also includes the root README, CONTRIBUTING and KNOWN_ISSUES,
the client README/UPGRADES/Firebase README, scripts README and patches guide.
`docs/archives`, `docs/references` and `docs/superpowers` are excluded.
`docs/legal` remains handled by the existing legal-page plugin.
The separate Astro application in `apps/docs` is unchanged.

Pages are physical HTML files and remain readable without JavaScript. Search
is progressive enhancement. Raw HTML is escaped, unsafe URL schemes are
rejected, and duplicate routes fail the build. Markdown tables and code blocks
are supported; MDX and Mermaid diagrams are not executed. Relative images use
their raw GitHub URL on `staging`; links to unpublished source files open GitHub.

The legacy `/docs/` entry redirects to `/documentation/`. There is no scheduled
sync, runtime GitHub dependency for articles, token, or additional hosted service.
Documentation changes and relevant PR updates use one scoped Actions build;
billing depends on the repository plan and actual job duration.

## Project activity

The landing lazily reads public open GitHub issues from
`SIMOND-ANCE-BROS/FFD-Connect`. It excludes pull requests and shows an honest
fallback if GitHub is unavailable or rate-limited. This is independent of the
static documentation build and never wakes the application backend.

## Documentation audiences and authoring

`/documentation/` is the audience chooser. Each space has its own directory,
search and article navigation:

- `/documentation/utilisateurs/`: usage guides from `docs/utilisateurs/**/*.md`.
- `/documentation/technique/`: all other published project Markdown and READMEs.

Existing technical article URLs are retained. Add a French Markdown file under
`docs/utilisateurs/` to publish a user guide automatically, including nested
folders. Keep developer setup, infrastructure and API details in the technical
space. The two index slugs (`utilisateurs` and `technique`) are reserved; do not
create root Markdown files or folder READMEs that generate either exact slug.

User guides should state the required role, entry screen, numbered steps,
expected result and what to do when an action is unavailable. Describe the app's
actual visible controls; do not describe roadmap items as released features.
The role cards point to maintained starting guides; new task guides appear in
the directory automatically. Front matter is optional and is not used to decide
an article's audience.

Initial guides were checked against app/admin source at `e6807db` on 9 October
2026: `MainTabs`, `SpaceSelector`/`SpaceSheet`, `SettingsScreen`,
`ClubDashboardScreen`, `CompetitionDetailScreen`, `LicenseScreen`,
`ScannerScreen`/`useScannerLogic`, and the admin user/club pages. These are
source-reviewed walkthroughs, not a claim of authenticated device testing.
The older Astro MDX guides are not imported: they use a separate renderer and
some describe earlier navigation. Their application remains unchanged; the
canonical source for this landing's user guides is `docs/utilisateurs/`.

### Visual user guides

In any Markdown guide, use a fenced `ffd-parcours` block with one
`Screen | Action | Expected result` line per step (at least two). These steps
render as numbered cards and remain readable without JavaScript. Text is escaped;
HTML is never accepted in this block.

Use a fenced `ffd-demo` block containing exactly `licence`, `competitions`,
`audio` or `organisation` to add an optional interactive example. The shared
landing adaptation loads only when the reader opens it. Failures keep the written
guide available and reopening retries the load. These are web adaptations with
fictional data, not native screenshots or authenticated app sessions. Keep native
screenshots distinct and add them only after capturing a reviewed test account.

### Guide review metadata and reference checks

Optional Markdown frontmatter records a **source review**, not a device test:

```yaml
---
reviewed_version: 1.0.0
reviewed_date: 2026-10-11
reviewed_commit: 4f1dd8a766d9ecfca8cee6fadbbb25fb9c423a80
reviewed_scope: Inscription et connexion
---
```

All four fields are required together. Update them only after reviewing the stated
scope against that app revision; publishing the site never advances them automatically.
Guides without metadata explicitly show that their app version is not verified.

The Vite build checks local documentation destinations, documentation fragments,
and local HTML assets after writing the build. Repository-relative Markdown images and linked Markdown documents
must exist when collecting the docs. Failures name the source page and destination.
Both root and `BASE_PATH=/FFD-Connect/` deployments are supported. External HTTP
resources and fragments rendered by the landing's React app are outside this static
check; no network probes are performed. Links intentionally directed to GitHub
(for source files or excluded documentation) remain external links.
