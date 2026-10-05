#!/usr/bin/env bash
# Garde-fou avant toute publication du dépôt : cherche dans les fichiers SUIVIS
# d'un arbre git les données qui ne doivent jamais devenir publiques
# (RGPD : personnes réelles, mineurs ; droit d'auteur : audio commercial).
#
# Usage : scripts/public-repo/scan-pii.sh [chemin-du-dépôt]   (défaut : .)
# Code retour : 0 = propre, 1 = au moins une trouvaille (à examiner, pas à ignorer).
#
# Les noms de personnes réelles à traquer ne sont PAS écrits ici (ce script est
# publié) : ils vivent dans scripts/public-repo/.pii-denylist, gitignoré, un
# motif (regex insensible à la casse) par ligne.
#
# Convention pour les données fictives : les numéros de licence de test
# utilisent le 1er janvier (AAAA0101-…), ce qui les distingue des vrais
# numéros, qui encodent la date de naissance.
set -uo pipefail

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
DENYLIST="$SELF_DIR/.pii-denylist"
REPO="${1:-.}"
cd "$REPO" || exit 2
found=0

report() {
  echo "✗ $1"
  printf '%s\n' "$2" | sed 's/^/    /' | head -20
  found=1
}

# 1. Fichiers qui n'ont rien à faire dans le dépôt public.
files=$(git ls-files | grep -iE '(^|/)scraped_data\.json$|(^|/)uploads/|\.(mp3|wav|m4a|aac|flac|ogg)$|(^|/)reports/.*\.(png|jpe?g)$|\.tfstate$|(^|/)\.env$|(^|/)\.pii-denylist$' || true)
[ -n "$files" ] && report "Fichiers interdits (seed scrapé, uploads, audio, captures de rapports, tfstate, .env)" "$files"

# 2. Numéros de licence FFD réels (AAAAMMJJ-xxx-yyNN) hors 1er janvier.
lic=$(git grep -nIE '\b(19|20)[0-9]{2}(0[1-9]|1[0-2])([0-2][0-9]|3[01])-[a-z]{3}-[a-z]{2}[0-9]{2}\b' -- ':!pnpm-lock.yaml' \
  | grep -vE '\b(19|20)[0-9]{2}0101-' || true)
[ -n "$lic" ] && report "Numéros de licence non fictifs (doivent être en AAAA0101-…)" "$lic"

# 3. Adresses e-mail personnelles (fournisseurs grand public).
mails=$(git grep -nIiE '[a-z0-9._%+-]+@(gmail|googlemail|hotmail|live|outlook|yahoo|icloud|me|free|orange|wanadoo|laposte|sfr|gmx|protonmail|proton)\.[a-z.]{2,}' -- ':!pnpm-lock.yaml' || true)
[ -n "$mails" ] && report "E-mails personnels" "$mails"

# 4. Personnes réelles connues (liste locale, jamais committée).
if [ -s "$DENYLIST" ]; then
  pattern=$(grep -vE '^\s*(#|$)' "$DENYLIST" | paste -sd'|' -)
  if [ -n "$pattern" ]; then
    names=$(git grep -nIiE "$pattern" || true)
    [ -n "$names" ] && report "Personnes réelles de la liste locale" "$names"
  fi
else
  echo "⚠ $DENYLIST absent ou vide : contrôle des noms réels SAUTÉ."
  found=1
fi

if [ "$found" -eq 0 ]; then
  echo "✓ Aucune donnée interdite trouvée dans les fichiers suivis de $(pwd)"
fi
exit "$found"
