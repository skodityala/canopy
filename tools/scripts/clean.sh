#!/usr/bin/env bash
# Remove compiled artifacts that shadow TypeScript sources.
#
# If tsc is ever run in place, tools/ and packages/ accumulate .js/.d.ts/.map
# next to the .ts they came from. Vitest and vite-node resolve the stale .js in
# PREFERENCE to the .ts, so the suite silently executes last month's compiled
# output. Observed symptom: loadFixtures.js reading an old 'yard.geojson'
# filename long after the .ts moved to 'yard.json' — 23 tests failing with no
# source defect. These files are gitignored, so a fresh clone looks fine and the
# problem is invisible to anyone who has not built in place.
#
# A test that passes only because it ran stale output is worse than a failing one.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

removed=0
while IFS= read -r f; do
  rm -f "$f"
  removed=$((removed + 1))
done < <(find tools packages apps -type f \
  \( -name '*.js' -o -name '*.d.ts' -o -name '*.js.map' -o -name '*.d.ts.map' \) \
  -not -path '*/node_modules/*' \
  -not -path '*/dist/*' \
  -not -name 'vite.config.js' 2>/dev/null || true)

find . -maxdepth 3 -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete 2>/dev/null || true

echo "clean: removed ${removed} compiled artifact(s) shadowing TypeScript sources"
