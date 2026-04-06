#!/usr/bin/env bash
#
# release.sh — Full release workflow for magus marketplace.
#
# Steps:
#   1. Sync shared dependencies into plugin lib/ directories
#   2. Convert marketplace.json sources to git-subdir format with current SHA
#   3. Print instructions for committing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}=== Magus Marketplace Release ===${NC}"
echo ""

# Step 1: Sync shared deps
echo -e "${CYAN}--- Step 1: Sync shared dependencies ---${NC}"
"$SCRIPT_DIR/sync-shared-deps.sh"
echo ""

# Step 2: Update marketplace.json
echo -e "${CYAN}--- Step 2: Update marketplace.json sources ---${NC}"
"$SCRIPT_DIR/release-marketplace.sh"
echo ""

# Step 3: Instructions
echo -e "${CYAN}--- Next steps ---${NC}"
echo -e "  1. Review changes:  ${YELLOW}git diff${NC}"
echo -e "  2. Stage changes:   ${YELLOW}git add -A${NC}"
echo -e "  3. Commit:          ${YELLOW}git commit -m \"Release: update marketplace sources to git-subdir\"${NC}"
echo -e "  4. Push:            ${YELLOW}git push${NC}"
echo ""
echo -e "${GREEN}Release preparation complete.${NC}"
