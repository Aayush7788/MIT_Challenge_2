#!/usr/bin/env bash
# Makes a throwaway copy of the repo for the "add a new city" demo, so the
# submitted files never change. Run it, then follow the two commands it prints.
#
#   bash scripts/demo-new-city.sh                  # copy goes to ../navigator-demo
#   bash scripts/demo-new-city.sh /tmp/demo-copy
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${1:-../navigator-demo}"
rm -rf "$DEST"
rsync -a --exclude node_modules --exclude .next --exclude .git ./ "$DEST/"
# Next's dev server rejects a node_modules symlink that points outside the project,
# so copy it: on macOS cp -c makes an APFS clone (instant, no extra disk).
cp -cR node_modules "$DEST/node_modules" 2>/dev/null || rsync -a node_modules "$DEST/"
if [ -f .env.local ]; then cp .env.local "$DEST/.env.local"; fi
cat <<MSG
Demo copy ready in $DEST (not a git repo; delete it when you're done).

  cd "$DEST"
  npm run ingest -- demo/new-city/oakland --jurisdiction "Oakland, CA"
  npm run dev -- --port 3008

Then open http://localhost:3008, pick "Any US address" and look up an Oakland address.
MSG
