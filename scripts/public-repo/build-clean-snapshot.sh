#!/usr/bin/env bash
# Construit le dépôt public à partir d'un SEUL commit racine (aucun historique) :
# l'historique complet, qui contient des données personnelles et de l'audio
# commercial, reste dans le dépôt privé d'archive.
#
# Usage :
#   scripts/public-repo/build-clean-snapshot.sh <source> <destination> [--push]
#     <source>       dépôt d'archive (URL ou chemin) dont on prend la branche develop
#     <destination>  URL du nouveau dépôt (vide, Actions DÉSACTIVÉES)
#     --push         pousse develop, staging et master ; sans ce drapeau : dry-run
#
# Exemple :
#   scripts/public-repo/build-clean-snapshot.sh \
#     https://github.com/SIMOND-ANCE-BROS/FFD-Connect-archive.git \
#     https://github.com/SIMOND-ANCE-BROS/FFD-Connect.git --push
set -euo pipefail

SRC="${1:?source manquante}"
DEST="${2:?destination manquante}"
PUSH="${3:-}"
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "→ Clone superficiel de develop depuis $SRC"
git clone --quiet --depth 1 --branch develop --single-branch "$SRC" "$WORK/src"
SRC_SHA=$(git -C "$WORK/src" rev-parse --short HEAD)

echo "→ Export des seuls fichiers suivis (git archive : aucun fichier ignoré, aucun objet d'historique)"
mkdir "$WORK/clean"
git -C "$WORK/src" archive HEAD | tar -x -C "$WORK/clean"

cd "$WORK/clean"
git init --quiet --initial-branch=develop
git add -A
git -c commit.gpgsign=false commit --quiet \
  -m "chore: initial public snapshot (from private archive @ $SRC_SHA)" \
  -m "History before this commit lives in the private archive repository."

echo "→ Contrôle données personnelles / droit d'auteur"
# Le scanner et sa liste locale viennent du dépôt d'où on lance ce script.
if ! "$SELF_DIR/scan-pii.sh" "$WORK/clean"; then
  echo "✗ Snapshot NON publiable : corriger dans le dépôt source, puis relancer." >&2
  exit 1
fi

echo "→ Snapshot prêt : $(git rev-parse --short HEAD), $(git ls-files | wc -l | tr -d ' ') fichiers, $(du -sh .git | cut -f1) d'objets"
if [ "$PUSH" != "--push" ]; then
  echo "Dry-run : rien n'a été poussé. Relancer avec --push."
  exit 0
fi

git remote add origin "$DEST"
# Les trois branches de la cascade partent du même commit propre (cf. runbook).
git push --quiet origin develop develop:staging develop:master
echo "✓ Poussé vers $DEST : develop, staging, master"
