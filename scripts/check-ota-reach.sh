#!/usr/bin/env bash
# Vérifie qu'une OTA peut atteindre au moins un build de son canal.
#
# Avec runtimeVersion `policy: "fingerprint"`, une OTA n'est servie qu'aux
# binaires de même empreinte. Si l'empreinte calculée au moment de `eas update`
# diffère de celle du build (mauvaise EXPO_PUBLIC_APP_ENV, config native qui
# dépend de l'environnement…), EAS publie sans broncher et aucun appareil ne
# reçoit rien. Ce script rend ce cas visible.
#
# Usage : check-ota-reach.sh <channel> <fichier JSON> [--strict]
#   <fichier JSON>  sortie de `eas update --json`, ou un tableau
#                   [{"platform":"ios","runtimeVersion":"…"}] construit avant de
#                   publier. Tout ce qui précède le JSON (bannière d'EAS sur
#                   stdout) est ignoré.
#   --strict        échoue (exit 1) si une plateforme qui a déjà des builds sur
#                   ce canal n'en a aucun avec cette empreinte. Sans lui : simple
#                   avertissement — un build natif lancé en parallèle (staging,
#                   production) peut ne pas être encore terminé.
#
# Une erreur d'EAS (réseau, jeton) n'est jamais fatale hors --strict : l'OTA
# est déjà publiée, le job ne doit pas virer au rouge pour un simple contrôle.
#
# À lancer depuis apps/client (là où EAS trouve le projet).
set -uo pipefail

CHANNEL="${1:?channel manquant}"
INPUT="${2:?fichier JSON manquant}"
STRICT="${3:-}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

fail_or_warn() {
  if [ "$STRICT" = "--strict" ]; then
    echo "::error::$1"
    exit 1
  fi
  echo "::warning::$1"
}

json=$(sed -n '/^[[{]/,$p' "$INPUT")
if ! jq -e 'type == "array" and length > 0' > /dev/null 2>&1 <<< "$json"; then
  fail_or_warn "Contrôle OTA \`$CHANNEL\` impossible : sortie JSON d'EAS illisible ou vide."
  exit 0
fi

# builds <platform> [runtime] → nombre de builds terminés sur le canal, ou vide si EAS échoue.
builds() {
  local args=(--channel "$CHANNEL" --platform "$1" --status finished --limit 1 --json --non-interactive)
  [ -n "${2:-}" ] && args+=(--runtime-version "$2")
  # Only an array is an answer: `length` of an error object counts its keys.
  eas build:list "${args[@]}" < /dev/null 2> /dev/null | sed -n '/^[[{]/,$p' \
    | jq 'if type == "array" then length else error("not an array") end' 2> /dev/null
}

missed=0
while read -r platform runtime; do
  count=$(builds "$platform" "$runtime")
  if [ -z "$count" ]; then
    fail_or_warn "OTA $platform : liste des builds EAS indisponible, contrôle non fait."
    continue
  fi
  if [ "$count" -gt 0 ]; then
    echo "✅ OTA $platform (runtime ${runtime:0:7}) : au moins un build \`$CHANNEL\` compatible" | tee -a "$summary"
    continue
  fi
  any=$(builds "$platform")
  if [ "${any:-0}" -eq 0 ]; then
    echo "ℹ️ OTA $platform : aucun build \`$CHANNEL\` sur cette plateforme, rien à atteindre." | tee -a "$summary"
    continue
  fi
  missed=1
  echo "::warning::OTA $platform (runtime ${runtime:0:7}) : aucun build \`$CHANNEL\` avec cette empreinte — elle n'atteindra aucun appareil tant qu'un build natif ne l'aura pas."
  echo "⚠️ OTA $platform (runtime ${runtime:0:7}) : aucun build \`$CHANNEL\` compatible" >> "$summary"
done < <(jq -r '.[] | "\(.platform) \(.runtimeVersion)"' <<< "$json" | sort -u)

if [ "$missed" -eq 1 ] && [ "$STRICT" = "--strict" ]; then
  echo "::error::OTA sans build \`$CHANNEL\` compatible. Lancer un build natif (action: build) ou vérifier EXPO_PUBLIC_APP_ENV."
  exit 1
fi
exit 0
