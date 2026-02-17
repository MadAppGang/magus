#!/bin/bash
# Skill disambiguation test suite runner
# Thin wrapper around the shared framework runner-base.sh
#
# Usage:
#   ./autotest/skills/run.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Examples:
#   ./autotest/skills/run.sh                             # All tests, monitor mode
#   ./autotest/skills/run.sh --cases skill-invoke-01 --dry-run

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite skills \
  "$@"
