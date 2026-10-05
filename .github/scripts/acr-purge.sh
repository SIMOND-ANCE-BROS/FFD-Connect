#!/bin/sh
# =============================================================================
# acr-purge.sh — prune ACR Basic repositories WITHOUT breaking live images
# =============================================================================
#
# ACR Basic has no retention policy (infra/terraform/acr.tf), so the deploy
# workflow prunes the registry itself. Incident #681: the old purge kept "the
# 15 newest tags" blindly; staging deploys pushed prod's image out, every new
# backend-prod revision went ImagePullBackOff and Azure kept re-activating a
# fallback revision whose failing replicas were billed for months. Each build
# also leaves untagged manifests behind (old :buildcache manifests, children of
# deleted indexes) — they were ~49 GB of a 53.6 GB registry.
#
# Rules, in order:
#   1. Inventory every image referenced by ANY Container App (current template
#      + ALL revisions, active or not) and Container Apps job visible to the
#      identity. If any query fails -> skip the purge entirely (never delete
#      blind). If REQUIRE_IMAGE is set and missing from the inventory -> skip
#      (the inventory is incomplete).
#   2. Keep: every non-SHA tag (latest, buildcache, manual tags), the KEEP
#      newest 40-hex SHA tags, every tag/digest referenced in step 1, and the
#      tags in KEEP_TAGS (the image being deployed).
#   3. Keep the full closure of kept manifests: children of a kept OCI index /
#      manifest list (platform images, buildx attestations) are never deleted.
#   4. Delete: stale SHA tags (untag when the manifest is still kept by another
#      tag, delete the manifest otherwise) and untagged manifests outside the
#      closure that are older than MIN_UNTAGGED_AGE_MIN (guards a concurrent
#      CI push whose children land before their index).
#
# Usage:  acr-purge.sh <acr-name> <keep-newest> <repository> [<repository>...]
# Env:    REQUIRE_IMAGE          full image ref that must be in the inventory
#         KEEP_TAGS              space-separated tags to always keep
#         MIN_UNTAGGED_AGE_MIN   default 60
#         PARALLEL               concurrent az calls, default 8
#         DRY_RUN=1              print the plan, delete nothing
# Needs:  az (containerapp extension), jq. Roles: Reader on the Container Apps
#         RG, AcrPush (read manifests) + AcrDelete on the registry (ci-iam.tf).
# =============================================================================
set -eu
export LC_ALL=C # stable sort order for comm

if [ "$#" -lt 3 ]; then
  echo "usage: $0 <acr-name> <keep-newest> <repository>..." >&2
  exit 2
fi

ACR_NAME=$1
KEEP=$2
shift 2
LOGIN_SERVER=$(printf '%s.azurecr.io' "$ACR_NAME" | tr '[:upper:]' '[:lower:]')
PARALLEL=${PARALLEL:-8}
MIN_AGE=${MIN_UNTAGGED_AGE_MIN:-60}
DRY_RUN=${DRY_RUN:-0}

W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT

skip_all() {
  echo "::warning::ACR purge skipped (nothing deleted) — $*"
  exit 0
}

# Images (containers + initContainers) of a JSON array of apps/revisions/jobs.
images_of() {
  jq -r '.[] | .properties.template | ((.containers // []) + (.initContainers // []))[] | .image // empty' "$1"
}

# ── 1. Inventory of referenced images ───────────────────────────────────────
echo "::group::Inventory of images referenced by Container Apps"
az containerapp list -o json >"$W/apps.json" 2>"$W/err" ||
  skip_all "cannot list Container Apps: $(tail -n 1 "$W/err")"
jq -e 'type == "array" and length > 0' "$W/apps.json" >/dev/null ||
  skip_all "no Container App visible to this identity (missing Reader role?)"
images_of "$W/apps.json" >"$W/current.txt" || skip_all "cannot parse Container Apps"
cp "$W/current.txt" "$W/images.txt"
jq -r '.[] | [.name, .resourceGroup] | @tsv' "$W/apps.json" >"$W/apps.tsv"

TAB=$(printf '\t')
while IFS=$TAB read -r APP RG; do
  az containerapp revision list -n "$APP" -g "$RG" --all -o json \
    >"$W/rev.json" 2>"$W/err" </dev/null ||
    skip_all "cannot list revisions of $APP: $(tail -n 1 "$W/err")"
  images_of "$W/rev.json" >>"$W/images.txt" || skip_all "cannot parse revisions of $APP"
  echo "$APP: $(jq length "$W/rev.json") revision(s)"
done <"$W/apps.tsv"

az containerapp job list -o json >"$W/jobs.json" 2>"$W/err" ||
  skip_all "cannot list Container Apps jobs: $(tail -n 1 "$W/err")"
images_of "$W/jobs.json" >>"$W/images.txt" || skip_all "cannot parse Container Apps jobs"

sort -u "$W/images.txt" -o "$W/images.txt"
echo "Distinct referenced images:"
sed 's/^/  /' "$W/images.txt"
echo "::endgroup::"

if [ -n "${REQUIRE_IMAGE:-}" ] && ! grep -qxF "$REQUIRE_IMAGE" "$W/images.txt"; then
  skip_all "inventory does not contain $REQUIRE_IMAGE (incomplete view?)"
fi

# Cutoff for untagged manifests (GNU date on runners, BSD date locally).
CUTOFF=$(date -u -d "-${MIN_AGE} minutes" +%Y-%m-%dT%H:%M:%S 2>/dev/null ||
  date -u -v-"${MIN_AGE}"M +%Y-%m-%dT%H:%M:%S)

# Run "<cmd-kind> <arg>" lines from a file through az, PARALLEL at a time.
# Returns non-zero if any call failed.
run_parallel() {
  [ -s "$1" ] || return 0
  xargs -P "$PARALLEL" -L 1 sh -c '
    kind=$1; ref=$2
    case $kind in
      untag)  az acr repository untag -n "$ACR" --image "$ref" -o none ;;
      delete) az acr repository delete -n "$ACR" --image "$ref" --yes -o none ;;
    esac 2>/dev/null || { echo "::warning::failed: $kind $ref"; exit 1; }
  ' _ <"$1"
}

FAILED=0
export ACR="$ACR_NAME"

purge_repo() {
  REPO=$1
  R="$W/$REPO"
  mkdir -p "$R"
  PREFIX="$LOGIN_SERVER/$REPO"
  echo "::group::Plan for $REPO"

  # Referenced tags / digests of this repository (repo:tag, repo@d, repo:tag@d).
  : >"$R/ref_tags"
  : >"$R/ref_digests"
  awk -v p="$PREFIX" -v T="$R/ref_tags" -v D="$R/ref_digests" '
    index($0, p) == 1 {
      rest = substr($0, length(p) + 1)
      c = substr(rest, 1, 1)
      if (c != ":" && c != "@") next
      at = index(rest, "@")
      tagpart = rest
      if (at > 0) { print substr(rest, at + 1) > D; tagpart = substr(rest, 1, at - 1) }
      if (substr(tagpart, 1, 1) == ":") print substr(tagpart, 2) > T
    }' "$W/images.txt"

  if az acr manifest list-metadata -r "$ACR_NAME" -n "$REPO" -o json \
    >"$R/meta.json" 2>"$R/err"; then :; else
    echo "::warning::$REPO: cannot list manifests, skipped — $(tail -n 1 "$R/err")"
    echo "::endgroup::"
    return 0
  fi
  if ! jq -e 'type == "array"' "$R/meta.json" >/dev/null; then
    echo "::warning::$REPO: unexpected manifest listing, skipped"
    echo "::endgroup::"
    return 0
  fi

  # digest <TAB> mediaType <TAB> time <TAB> space-separated tags
  jq -r '.[] | [.digest, (.mediaType // ""), (.lastUpdateTime // .createdTime // ""),
                ((.tags // []) | join(" "))] | @tsv' "$R/meta.json" >"$R/manifests.tsv"
  # tag <TAB> time, for tags only
  jq -r '.[] | . as $m | (.tags // [])[] | [., ($m.lastUpdateTime // $m.createdTime // "")] | @tsv' \
    "$R/meta.json" >"$R/tags.tsv"

  # Warn when a CURRENT app template points at a tag that no longer exists.
  grep -F "$PREFIX:" "$W/current.txt" | sed "s|^$PREFIX:||; s|@.*||" | sort -u |
    while read -r T; do
      cut -f1 "$R/tags.tsv" | grep -qxF "$T" ||
        echo "::warning::$REPO:$T is used by a Container App template but is MISSING from ACR (next revision will ImagePullBackOff)"
    done

  # ── 2. Tags to keep ──
  {
    cut -f1 "$R/tags.tsv" | grep -Evx '[0-9a-f]{40}' || true   # non-SHA tags
    grep -E "^[0-9a-f]{40}$TAB" "$R/tags.tsv" | sort -t "$TAB" -k2,2r | head -n "$KEEP" | cut -f1
    cat "$R/ref_tags"
    for T in ${KEEP_TAGS:-}; do echo "$T"; done
  } | sort -u >"$R/keep_tags"

  # ── 3. Kept digests + closure over index children ──
  {
    awk -F "$TAB" 'NR == FNR { k[$1] = 1; next }
      { n = split($4, t, " "); for (i = 1; i <= n; i++) if (t[i] in k) { print $1; break } }' \
      "$R/keep_tags" "$R/manifests.tsv"
    cat "$R/ref_digests"
  } | sort -u >"$R/keep_digests"

  awk -F "$TAB" '$2 ~ /index|manifest\.list/ { print $1 }' "$R/manifests.tsv" | sort -u >"$R/index_digests"
  comm -12 "$R/keep_digests" "$R/index_digests" >"$R/todo"
  while [ -s "$R/todo" ]; do
    rm -f "$R"/child.*
    # xargs appends the digest as $4; any failed read aborts this repo.
    if ! xargs -P "$PARALLEL" -n 1 sh -c '
      f="$3/child.${4#sha256:}"
      az acr manifest show -r "$1" -n "$2@$4" -o json >"$f.json" 2>/dev/null &&
        jq -r ".manifests[]?.digest // empty" "$f.json" >"$f.list"
    ' _ "$ACR_NAME" "$REPO" "$R" <"$R/todo"; then
      echo "::warning::$REPO: cannot read a kept index (children unknown), skipped"
      echo "::endgroup::"
      return 0
    fi
    cat "$R"/child.*.list >"$R/new"
    sort -u "$R/new" -o "$R/new"
    comm -23 "$R/new" "$R/keep_digests" >"$R/added"
    sort -u "$R/added" "$R/keep_digests" -o "$R/keep_digests"
    comm -12 "$R/added" "$R/index_digests" >"$R/todo"
  done

  # ── 4. Deletion plan ──
  : >"$R/ops_untag"
  : >"$R/ops_delete_index"
  : >"$R/ops_delete_other"
  awk -F "$TAB" -v repo="$REPO" -v cutoff="$CUTOFF" \
    -v KT="$R/keep_tags" -v KD="$R/keep_digests" \
    -v OU="$R/ops_untag" -v OI="$R/ops_delete_index" -v OO="$R/ops_delete_other" '
    BEGIN {
      while ((getline l < KT) > 0) kt[l] = 1
      while ((getline l < KD) > 0) kd[l] = 1
    }
    {
      d = $1; mt = $2; ts = substr($3, 1, 19); n = split($4, t, " ")
      if (d in kd) {
        for (i = 1; i <= n; i++) if (!(t[i] in kt)) print "untag " repo ":" t[i] > OU
        next
      }
      if (n == 0 && (ts == "" || ts >= cutoff)) next   # too recent (mid-push?) or unknown age
      out = (mt ~ /index|manifest\.list/) ? OI : OO
      print "delete " repo "@" d > out
    }' "$R/manifests.tsv"

  echo "Tags kept:          $(wc -l <"$R/keep_tags" | tr -d ' ')"
  echo "Manifests kept:     $(wc -l <"$R/keep_digests" | tr -d ' ') (incl. index children)"
  echo "Tags to untag:      $(wc -l <"$R/ops_untag" | tr -d ' ')"
  echo "Manifests to delete: $(cat "$R/ops_delete_index" "$R/ops_delete_other" | wc -l | tr -d ' ')"
  cat "$R/ops_untag" "$R/ops_delete_index" "$R/ops_delete_other" | sed 's/^/  /'
  echo "::endgroup::"

  if [ "$DRY_RUN" = "1" ]; then
    echo "DRY_RUN=1 — nothing deleted in $REPO"
    return 0
  fi
  # Untag first (never frees a kept manifest), then indexes, then the rest.
  run_parallel "$R/ops_untag" || FAILED=1
  run_parallel "$R/ops_delete_index" || FAILED=1
  run_parallel "$R/ops_delete_other" || FAILED=1
}

for REPO in "$@"; do
  purge_repo "$REPO"
done

if [ "$FAILED" -ne 0 ]; then
  echo "::warning::some ACR deletions failed (see above) — the next deploy retries them"
  exit 1
fi
echo "ACR purge done"
