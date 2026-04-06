#!/usr/bin/env bash
#
# release-marketplace.sh — Convert marketplace.json plugin sources to git-subdir format.
#
# For each plugin entry in .claude-plugin/marketplace.json, replaces the string
# "source" field with a git-subdir source object pinned to the current commit SHA.
#
# Idempotent: if sources are already git-subdir objects, only the SHA is updated.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKETPLACE="$REPO_ROOT/.claude-plugin/marketplace.json"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ ! -f "$MARKETPLACE" ]; then
  echo "ERROR: marketplace.json not found at $MARKETPLACE" >&2
  exit 1
fi

SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
REPO_URL="MadAppGang/magus"
REF="main"

echo -e "${CYAN}Updating marketplace.json sources to git-subdir format...${NC}"
echo -e "  Commit SHA: ${YELLOW}${SHA}${NC}"
echo -e "  Repo URL:   ${REPO_URL}"
echo -e "  Ref:        ${REF}"
echo ""

# Use python3 for reliable JSON manipulation (preserves field order and formatting)
python3 << PYEOF
import json
import sys

marketplace_path = "$MARKETPLACE"
sha = "$SHA"
repo_url = "$REPO_URL"
ref = "$REF"

with open(marketplace_path, "r") as f:
    data = json.load(f)

updated = 0
for plugin in data.get("plugins", []):
    name = plugin.get("name", "unknown")
    source = plugin.get("source")
    plugin_path = f"plugins/{name}"

    if isinstance(source, str):
        # Convert string source to git-subdir object
        plugin["source"] = {
            "source": "git-subdir",
            "url": repo_url,
            "path": plugin_path,
            "ref": ref,
            "sha": sha,
        }
        print(f"  \033[0;32mconverted\033[0m {name}: string -> git-subdir (sha: {sha[:8]})")
        updated += 1
    elif isinstance(source, dict) and source.get("source") == "git-subdir":
        # Already git-subdir — update SHA only
        old_sha = source.get("sha", "none")
        source["sha"] = sha
        if old_sha != sha:
            print(f"  \033[0;32mupdated\033[0m   {name}: sha {old_sha[:8]} -> {sha[:8]}")
            updated += 1
        else:
            print(f"  \033[0;36mskipped\033[0m   {name}: sha unchanged")
    else:
        print(f"  \033[1;33mwarning\033[0m   {name}: unknown source format, skipping")

with open(marketplace_path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")

print(f"\nDone. Updated {updated} plugin(s).")
PYEOF
