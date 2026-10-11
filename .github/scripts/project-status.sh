#!/usr/bin/env bash
# Move issues across the « FFD Connect — Roadmap » Project Status column.
#
# Usage: project-status.sh <status> <issue-number>...
#        project-status.sh --from <status> <new-status>
#   status: one of the Project's Status option names (Todo, In Progress,
#   In Review, Merged, In Beta, Done). Issues missing from the Project are added.
#   --from moves every card currently in <status> (used when a promotion to
#   staging ships all of develop: Merged → In Beta).
#
# Env: GH_TOKEN (org Projects read/write + repo issues read),
#      GITHUB_REPOSITORY, PROJECT_OWNER, PROJECT_NUMBER.
# Lifecycle and rules: docs/guides/gestion-des-issues.md §8.
set -euo pipefail

FROM=""
if [ "${1:-}" = "--from" ]; then
  FROM="${2:?--from needs a status}"
  shift 2
fi
STATUS="${1:?status required}"
shift
[ -n "$FROM" ] || [ "$#" -gt 0 ] || { echo "No issue to move."; exit 0; }

OWNER="${PROJECT_OWNER:?}"
NUMBER="${PROJECT_NUMBER:?}"
REPO_OWNER="${GITHUB_REPOSITORY%/*}"
REPO_NAME="${GITHUB_REPOSITORY#*/}"

# shellcheck disable=SC2016
project=$(gh api graphql -f owner="$OWNER" -F number="$NUMBER" -f query='
  query($owner: String!, $number: Int!) {
    organization(login: $owner) {
      projectV2(number: $number) {
        id
        field(name: "Status") {
          ... on ProjectV2SingleSelectField { id options { id name } }
        }
      }
    }
  }')

PROJECT_ID=$(jq -r '.data.organization.projectV2.id' <<<"$project")
FIELD_ID=$(jq -r '.data.organization.projectV2.field.id' <<<"$project")
OPTION_ID=$(jq -r --arg s "$STATUS" \
  '.data.organization.projectV2.field.options[] | select(.name == $s) | .id' <<<"$project")

if [ -z "$OPTION_ID" ]; then
  echo "::error::Status option '$STATUS' not found in the Project."
  exit 1
fi

set_status() {
  # shellcheck disable=SC2016
  gh api graphql -f project="$PROJECT_ID" -f item="$1" -f field="$FIELD_ID" -f option="$OPTION_ID" -f query='
    mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $project, itemId: $item, fieldId: $field,
        value: { singleSelectOptionId: $option }
      }) { projectV2Item { id } }
    }' >/dev/null
}

if [ -n "$FROM" ]; then
  # Every card of this repo whose Status is $FROM (paginated, 100 per page).
  cursor=""
  moved=0
  while :; do
    args=(-f project="$PROJECT_ID")
    [ -z "$cursor" ] || args+=(-f after="$cursor")
    # shellcheck disable=SC2016
    page=$(gh api graphql "${args[@]}" -f query='
      query($project: ID!, $after: String) {
        node(id: $project) {
          ... on ProjectV2 {
            items(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                fieldValueByName(name: "Status") {
                  ... on ProjectV2ItemFieldSingleSelectValue { name }
                }
                content { ... on Issue { number repository { nameWithOwner } } }
              }
            }
          }
        }
      }')
    while IFS=$'\t' read -r item number; do
      [ -n "$item" ] || continue
      set_status "$item"
      echo "#$number → $STATUS"
      moved=$((moved + 1))
    done < <(jq -r --arg from "$FROM" --arg repo "$GITHUB_REPOSITORY" '
      .data.node.items.nodes[]
      | select(.fieldValueByName.name == $from and .content.repository.nameWithOwner == $repo)
      | [.id, (.content.number | tostring)] | @tsv' <<<"$page")
    [ "$(jq -r '.data.node.items.pageInfo.hasNextPage' <<<"$page")" = "true" ] || break
    cursor=$(jq -r '.data.node.items.pageInfo.endCursor' <<<"$page")
  done
  echo "$moved card(s) moved from $FROM to $STATUS."
  exit 0
fi

for issue in "$@"; do
  # shellcheck disable=SC2016
  node=$(gh api graphql -f owner="$REPO_OWNER" -f name="$REPO_NAME" -F number="$issue" -f query='
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        issue(number: $number) { id }
      }
    }' --jq '.data.repository.issue.id' 2>/dev/null || true)

  if [ -z "$node" ] || [ "$node" = "null" ]; then
    echo "#$issue is not an issue of this repo — skipped."
    continue
  fi

  # Idempotent: returns the existing item when the issue is already in the Project.
  # shellcheck disable=SC2016
  item=$(gh api graphql -f project="$PROJECT_ID" -f content="$node" -f query='
    mutation($project: ID!, $content: ID!) {
      addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } }
    }' --jq '.data.addProjectV2ItemById.item.id')

  set_status "$item"
  echo "#$issue → $STATUS"
done
