#!/usr/bin/env bash
# Recopie labels, jalons et issues OUVERTES de l'archive privée vers le dépôt
# public. GitHub interdit de TRANSFÉRER une issue d'un dépôt privé vers un
# dépôt public : on les recrée, avec un lien vers l'original (lisible seulement
# par les membres de l'organisation).
#
# Usage : scripts/public-repo/copy-metadata.sh <archive> <public> [--apply]
#   sans --apply : dry-run (liste ce qui serait créé)
# Relire la liste avant --apply : une issue dont le corps cite une personne
# réelle ou une donnée sensible doit être exclue (EXCLUDE="12 34").
set -euo pipefail

SRC="${1:?archive owner/repo manquant}"
DEST="${2:?public owner/repo manquant}"
APPLY="${3:-}"
EXCLUDE=" ${EXCLUDE:-} "

if [ "$APPLY" = "--apply" ]; then
  echo "→ Labels"
  gh label clone "$SRC" -R "$DEST" --force
  echo "→ Jalons"
  gh api "repos/$SRC/milestones?state=open&per_page=100" \
    --jq '.[] | [.title, (.description // ""), (.due_on // "")] | @tsv' |
    while IFS=$'\t' read -r title desc due; do
      args=(-f title="$title" -f description="$desc")
      [ -n "$due" ] && args+=(-f due_on="$due")
      gh api "repos/$DEST/milestones" --silent "${args[@]}" || echo "  (déjà présent) $title"
    done
fi

echo "→ Issues ouvertes (de la plus ancienne à la plus récente)"
gh issue list -R "$SRC" --state open --limit 500 \
  --json number,title,labels,milestone \
  --jq 'sort_by(.number) | .[] | [.number, .title, ([.labels[].name] | join(",")), (.milestone.title // "")] | @tsv' |
  while IFS=$'\t' read -r num title labels milestone; do
    if [[ "$EXCLUDE" == *" $num "* ]]; then
      echo "  EXCLUE #$num $title"
      continue
    fi
    if [ "$APPLY" != "--apply" ]; then
      echo "  #$num $title [$labels] {$milestone}"
      continue
    fi
    body=$(gh issue view "$num" -R "$SRC" --json body --jq .body)
    body="$body"$'\n\n---\n'"_Migrée depuis l'archive privée : $SRC#${num}_"
    args=(-R "$DEST" --title "$title" --body "$body")
    [ -n "$labels" ] && args+=(--label "$labels")
    [ -n "$milestone" ] && args+=(--milestone "$milestone")
    url=$(gh issue create "${args[@]}")
    echo "  #$num → $url"
  done

[ "$APPLY" = "--apply" ] || echo "Dry-run : rien n'a été créé. Relancer avec --apply."
