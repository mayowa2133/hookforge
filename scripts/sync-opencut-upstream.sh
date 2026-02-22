#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REMOTE="${OPENCUT_UPSTREAM_REMOTE:-upstream}"
UPSTREAM_BRANCH="${OPENCUT_UPSTREAM_BRANCH:-main}"
SYNC_MODE="${OPENCUT_SYNC_MODE:-rebase}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Must run inside a git repository." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is not clean. Commit or stash changes before syncing." >&2
  exit 1
fi

if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
  cat >&2 <<EOF
Remote '$UPSTREAM_REMOTE' does not exist.
Add it first, for example:
  git remote add upstream https://github.com/OpenCut-app/OpenCut.git
EOF
  exit 1
fi

echo "Fetching $UPSTREAM_REMOTE/$UPSTREAM_BRANCH..."
git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"

if [[ "$SYNC_MODE" == "merge" ]]; then
  echo "Merging $UPSTREAM_REMOTE/$UPSTREAM_BRANCH into $(git branch --show-current)..."
  git merge --no-ff "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
else
  echo "Rebasing $(git branch --show-current) onto $UPSTREAM_REMOTE/$UPSTREAM_BRANCH..."
  git rebase "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
fi

UPSTREAM_SHA="$(git rev-parse "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")"
echo "Sync complete."
echo "Upstream baseline SHA: $UPSTREAM_SHA"
echo "Update docs/legal/OPENCUT_UPSTREAM_BASELINE.md with this baseline entry."
