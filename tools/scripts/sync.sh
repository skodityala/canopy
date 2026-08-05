#!/usr/bin/env bash
# Commit everything staged/unstaged and push to origin/main, then verify the
# remote actually advanced. Used throughout the build so a "push" is never
# assumed — it is confirmed against the GitHub API.
#
# Usage: tools/scripts/sync.sh "commit message"
set -euo pipefail

MSG="${1:?usage: sync.sh \"commit message\"}"
cd "$(git rev-parse --show-toplevel)"

if [[ -z "$(git status --porcelain)" ]]; then
  echo "sync: nothing to commit"
else
  git add -A
  git commit -q -m "$MSG"
  echo "sync: committed $(git rev-parse --short HEAD)"
fi

git push -q origin main
git fetch -q origin

LOCAL="$(git rev-parse main)"
REMOTE="$(git rev-parse origin/main)"
if [[ "$LOCAL" != "$REMOTE" ]]; then
  echo "sync: FAILED — local $LOCAL != remote $REMOTE" >&2
  exit 1
fi
echo "sync: OK — origin/main at $(git rev-parse --short origin/main)"
