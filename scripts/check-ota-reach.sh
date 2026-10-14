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

# uploaded <platform> <runtime> → nombre de builds terminés portant cette
# empreinte, quel que soit le canal. Un binaire construit sur un runner GitHub
# (`eas build --local`, #508) n'est connu d'EAS que par `eas upload`, qui
# l'enregistre sans canal ni runtimeVersion mais avec son empreinte. Avec
# `policy: "fingerprint"`, empreinte = runtimeVersion, et elle dépend de la
# variante : une correspondance est donc un build de ce canal.
# Resserré (#511) : jamais un build simulateur iOS, et sur iOS seulement le
# bundle id du profil (= canal) ; eas upload le lit dans l'Info.plist, les
# uploads Android n'en portent pas. Bundle id illisible → aucune correspondance.
# Hypothèse restante (docs/exploitation/ci-cd.md) : qui peut faire `eas upload`
# sur le projet est de confiance — le même accès publie des OTA.
uploaded() {
  local app=""
  if [ "$1" = "ios" ]; then
    app=$(eas config --profile "$CHANNEL" --platform ios --json --non-interactive \
      < /dev/null 2> /dev/null | sed -n '/^{/,$p' \
      | jq -r '.appConfig.ios.bundleIdentifier // empty' 2> /dev/null)
  fi
  eas build:list --platform "$1" --fingerprint-hash "$2" --status finished --limit 10 --json --non-interactive \
    < /dev/null 2> /dev/null | sed -n '/^[[{]/,$p' \
    | jq --arg platform "$1" --arg app "$app" '
        if type == "array" then
          [.[] | select(.isForIosSimulator != true)
            | select($platform != "ios" or ($app != "" and .appIdentifier == $app))]
          | length
        else error("not an array") end' 2> /dev/null
}

# released <platform> <runtime> → succès si une release GitHub
# `beta-<version>-<platform>-<n°>` déclare cette empreinte (canal beta
# seulement, #510). Secours pour un binaire beta construit sur runner GitHub
# dont `eas upload` a échoué ou n'existait pas encore (build iOS 27) :
# release-beta écrit « Runtime fingerprint: `<hash>` » dans l'en-tête. Exige
# gh, GH_TOKEN et GITHUB_REPOSITORY (en CI) ; sinon, simple échec.
released() {
  [ "$CHANNEL" = "beta" ] || return 1
  [ -n "${GH_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] || return 1
  command -v gh > /dev/null 2>&1 || return 1
  case "$1" in ios | android) ;; *) return 1 ;; esac
  [[ "$2" =~ ^[0-9a-f]{40}$ ]] || return 1
  # Toutes les pages : les releases OTA preview quotidiennes repoussent vite
  # les beta-* hors de la première. grep sans -q : avec pipefail, une sortie
  # anticipée de grep ferait échouer gh (SIGPIPE) et donc le test.
  # Seulement les releases créées par la CI (github-actions[bot]) et la
  # PREMIÈRE ligne du corps (l'en-tête écrit par release-beta) : les notes qui
  # suivent viennent des PR et ne doivent pas pouvoir faire passer le contrôle.
  gh api --paginate "repos/$GITHUB_REPOSITORY/releases?per_page=100" \
    --jq ".[] | select(.tag_name | test(\"^beta-[0-9.]+-$1-[0-9]+\$\"))
      | select(.author.login == \"github-actions[bot]\") | ((.body // \"\") | split(\"\n\")[0] // \"\")" \
    < /dev/null 2> /dev/null | grep -F "Runtime fingerprint: \`$2\`" > /dev/null
}

missed=0
while read -r platform runtime; do
  count=$(builds "$platform" "$runtime")
  if [ -z "$count" ]; then
    fail_or_warn "OTA $platform : liste des builds EAS indisponible, contrôle non fait."
    continue
  fi
  if [ "$count" -eq 0 ] && [ "$(uploaded "$platform" "$runtime")" -gt 0 ] 2> /dev/null; then
    echo "✅ OTA $platform (runtime ${runtime:0:7}) : au moins un build compatible (runner GitHub, envoyé par eas upload)" | tee -a "$summary"
    continue
  fi
  if [ "$count" -eq 0 ] && released "$platform" "$runtime"; then
    echo "✅ OTA $platform (runtime ${runtime:0:7}) : build \`$CHANNEL\` compatible déclaré par une release GitHub beta-* (runner GitHub, sans eas upload)" | tee -a "$summary"
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
