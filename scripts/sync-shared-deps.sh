#!/usr/bin/env bash
#
# sync-shared-deps.sh — Copy shared files into plugin lib/ directories.
#
# With git-subdir sources, each plugin must be self-contained (no imports
# outside its own directory). This script copies shared dependencies into
# each plugin's lib/ folder so they can import locally.
#
# Run this before release-marketplace.sh to ensure plugins are up to date.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Colors for output
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

synced=0

sync_file() {
  local src="$1"
  local dst="$2"
  local label="$3"

  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  echo -e "  ${GREEN}synced${NC} ${label}"
  synced=$((synced + 1))
}

echo -e "${CYAN}Syncing shared dependencies into plugin lib/ directories...${NC}"
echo ""

# shared/model-aliases.json -> plugins that use it
sync_file \
  "$REPO_ROOT/shared/model-aliases.json" \
  "$REPO_ROOT/plugins/dev/lib/model-aliases.json" \
  "shared/model-aliases.json -> plugins/dev/lib/model-aliases.json"

sync_file \
  "$REPO_ROOT/shared/model-aliases.json" \
  "$REPO_ROOT/plugins/nanobanana/lib/model-aliases.json" \
  "shared/model-aliases.json -> plugins/nanobanana/lib/model-aliases.json"

# tools/table/index.ts -> plugins that use it
sync_file \
  "$REPO_ROOT/tools/table/index.ts" \
  "$REPO_ROOT/plugins/kanban/lib/table.ts" \
  "tools/table/index.ts -> plugins/kanban/lib/table.ts"

sync_file \
  "$REPO_ROOT/tools/table/index.ts" \
  "$REPO_ROOT/plugins/gtd/lib/table.ts" \
  "tools/table/index.ts -> plugins/gtd/lib/table.ts"

echo ""
echo -e "${GREEN}Done.${NC} Synced ${synced} files."
