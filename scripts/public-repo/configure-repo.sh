#!/usr/bin/env bash
# Applique au nouveau dépôt les réglages du dépôt d'origine (relevés le
# 2026-10-05) : options de merge, protections de branche, environnements,
# fonctions de sécurité gratuites sur un dépôt public.
# Remplace l'ancien scripts/setup-branch-protection.sh (checks périmés).
#
# Les SECRETS ne sont pas gérés ici (valeurs illisibles via l'API) : voir le
# runbook docs/exploitation/bascule-repo-public.md, étape B5.
#
# Usage : scripts/public-repo/configure-repo.sh SIMOND-ANCE-BROS/FFD-Connect
set -euo pipefail

REPO="${1:?owner/repo manquant}"
echo "→ Réglages généraux de $REPO"
gh api -X PATCH "repos/$REPO" --silent \
  -f default_branch=develop \
  -F allow_squash_merge=true -F allow_merge_commit=true -F allow_rebase_merge=true \
  -F allow_auto_merge=true -F delete_branch_on_merge=false \
  -F has_wiki=false -F has_projects=true

# Seul check requis partout : l'agrégateur « CI Success » de ci.yml.
protect() {
  local branch="$1" strict="$2" admins="$3"
  gh api -X PUT "repos/$REPO/branches/$branch/protection" --silent --input - <<EOF
{
  "required_status_checks": { "strict": $strict, "contexts": ["CI Success"] },
  "enforce_admins": $admins,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
  echo "  $branch : protégée (strict=$strict, admins=$admins)"
}
echo "→ Protections de branche"
protect develop false false
protect staging true true
protect master true true

echo "→ Environnements (référencés par les workflows)"
for env in staging production app-production; do
  gh api -X PUT "repos/$REPO/environments/$env" --silent
  echo "  $env"
done

echo "→ Actions : durcissement pour un dépôt public"
# Un fork peut ouvrir une PR : ses workflows ne tournent qu'après approbation
# manuelle, et le GITHUB_TOKEN par défaut reste en lecture seule.
gh api -X PUT "repos/$REPO/actions/permissions/fork-pr-contributor-approval" --silent \
  -f approval_policy=all_external_contributors
gh api -X PUT "repos/$REPO/actions/permissions/workflow" --silent \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false

echo "→ Sécurité (gratuit sur dépôt public)"
gh api -X PUT "repos/$REPO/vulnerability-alerts" --silent
gh api -X PUT "repos/$REPO/automated-security-fixes" --silent
gh api -X PATCH "repos/$REPO" --silent --input - <<'EOF'
{ "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" } } }
EOF
gh api -X PUT "repos/$REPO/private-vulnerability-reporting" --silent
echo "✓ $REPO configuré. Reste : secrets (B5), apps Codecov/Claude (B8)."
