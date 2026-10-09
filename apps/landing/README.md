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
