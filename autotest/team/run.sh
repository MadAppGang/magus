#!/bin/bash
# Team command test suite runner
# Thin wrapper around the shared framework runner-base.sh
#
# Usage:
#   ./autotest/team/run.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Examples:
#   ./autotest/team/run.sh                               # All tests, monitor mode
#   ./autotest/team/run.sh --cases team-agent-internal --dry-run

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite team \
  "$@"
