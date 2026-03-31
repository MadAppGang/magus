#!/bin/bash
# Model aliases test suite runner
# Tests that model alias resolution, /update-models, and CLAUDE.md enforcement work correctly.
#
# Usage:
#   ./autotest/model-aliases/run.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Examples:
#   ./autotest/model-aliases/run.sh                                    # All tests, monitor mode
#   ./autotest/model-aliases/run.sh --model claude-sonnet-4-6          # Specific model
#   ./autotest/model-aliases/run.sh --cases alias-reads-file-01        # Specific test

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Model aliases tests require multimodel plugin (for /team, /delegate commands)
export EXTRA_PLUGIN_DIRS="$REPO_ROOT/plugins/multimodel"

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite model-aliases \
  --analyzer "bun $SCRIPT_DIR/analyze-transcript.ts" \
  "$@"
