# Shared preamble of the versioned git hooks (#623). Sourced, not executed.
#
# core.hooksPath = .githooks (relative, set by `pnpm install` through the root
# `prepare` script, scripts/install-git-hooks.sh). Git resolves a relative
# hooksPath against the top of the work tree running the hook, so every
# worktree runs ITS OWN hooks, and since this directory is versioned a fresh
# worktree has them before any install. What a fresh worktree lacks is
# node_modules: the hooks then FAIL LOUDLY instead of being silently skipped.
#
# Opt-out: HUSKY=0 (kept from Husky, for automation only). Never --no-verify.

[ "${HUSKY-}" = "0" ] && exit 0

# Same optional user init as Husky (nvm/fnm setup for GUI git clients).
hooks_init="${XDG_CONFIG_HOME:-$HOME/.config}/husky/init.sh"
# shellcheck disable=SC1090
[ -f "$hooks_init" ] && . "$hooks_init"

hooks_root=$(git rev-parse --show-toplevel) || exit 1
cd "$hooks_root" || exit 1
export PATH="$hooks_root/node_modules/.bin:$PATH"

# require_deps <path>... : every path (relative to the work tree root) must
# exist, and pnpm must be on PATH, else the commit/push is refused with the fix.
require_deps() {
  hooks_missing=""
  for hooks_dep in "$@"; do
    [ -e "$hooks_dep" ] || hooks_missing="$hooks_missing $hooks_dep"
  done
  command -v pnpm >/dev/null 2>&1 || hooks_missing="$hooks_missing pnpm(PATH)"
  [ -z "$hooks_missing" ] && return 0
  {
    echo ""
    echo "Hooks FFD-Connect : dépendances absentes — lancez \`pnpm install --frozen-lockfile\`"
    echo "  hook     : $(basename "$0")"
    echo "  worktree : $hooks_root"
    echo "  manquant :$hooks_missing"
    echo "  Ne jamais contourner avec --no-verify (CONTRIBUTING.md)."
    echo ""
  } >&2
  exit 1
}
