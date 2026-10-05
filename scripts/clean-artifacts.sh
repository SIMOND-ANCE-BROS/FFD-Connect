#!/usr/bin/env bash
#
# Nettoie les artefacts de build/tests (coverage, reports, cache, .md d'explication).
# Rien n'est supprimé de façon "permanente" au sens du repo : ce sont des fichiers
# régénérables (coverage, rapports) ou des docs d'explication temporaires.
#
# Usage:
#   ./scripts/clean-artifacts.sh           # nettoie coverage, reports, cache
#   ./scripts/clean-artifacts.sh --docs   # + .md d'explication (apps/client/docs, etc.)
#   ./scripts/clean-artifacts.sh --dry-run
#

set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

DRY_RUN=false
INCLUDE_DOCS=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --docs)
      INCLUDE_DOCS=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [--docs]"
      echo "  --dry-run   Affiche ce qui serait supprimé sans supprimer."
      echo "  --docs      Inclut les .md d'explication (apps/client/docs/, etc.)."
      exit 0
      ;;
    *)
      echo "Option inconnue: $1" >&2
      exit 1
      ;;
  esac
done

rm_cmd() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[dry-run] rm -rf $*"
  else
    rm -rf "$@"
  fi
}

rm_file() {
  if [[ "$DRY_RUN" == "true" ]]; then
    for f in "$@"; do
      if [[ -e "$f" ]]; then echo "[dry-run] rm $f"; fi
    done
  else
    for f in "$@"; do
      if [[ -e "$f" ]]; then rm -f "$f"; fi
    done
  fi
}

echo "Nettoyage des artefacts (root: $ROOT)"

# --- Coverage (Jest) ---
for dir in "$ROOT/coverage" "$ROOT/apps/backend/coverage" "$ROOT/apps/client/coverage"; do
  if [[ -d "$dir" ]]; then
    rm_cmd "$dir"
    echo "  supprimé: $dir"
  fi
done

# --- Cache Jest ---
for dir in "$ROOT/.jest-cache" "$ROOT/apps/backend/.jest-cache" "$ROOT/apps/client/.jest-cache"; do
  if [[ -d "$dir" ]]; then
    rm_cmd "$dir"
    echo "  supprimé: $dir"
  fi
done

# --- Rapports / artifacts (lint, coverage report) ---
for base in "$ROOT" "$ROOT/apps/backend" "$ROOT/apps/client"; do
  for f in "$base/lint-results.json" "$base/lint-results-fresh.json" "$base/lint-results2.json" "$base/coverage-report.json" "$base/output.json"; do
    if [[ -f "$f" ]]; then
      rm_file "$f"
      echo "  supprimé: $f"
    fi
  done
done

# --- .md d'explication (optionnel) : docs de debug / analyse temporaires ---
if [[ "$INCLUDE_DOCS" == "true" ]]; then
  # Dossier apps/client/docs (DEBUG_*, SENTRY_BETA, etc.) — exclusions : README / ARCHITECTURE si tu veux les garder, retire-les de la liste
  if [[ -d "$ROOT/apps/client/docs" ]]; then
    for f in "$ROOT/apps/client/docs/"*.md; do
      if [[ -f "$f" ]]; then
        rm_file "$f"
        echo "  supprimé: $f"
      fi
    done
  fi
  # Fichiers d'analyse à la racine de docs/ (régénérables / explication)
  for f in "$ROOT/docs/TEST_COVERAGE_ANALYSIS.md"; do
    if [[ -f "$f" ]]; then
      rm_file "$f"
      echo "  supprimé: $f"
    fi
  done
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "Mode dry-run : aucune suppression effectuée."
else
  echo "Nettoyage terminé."
fi
