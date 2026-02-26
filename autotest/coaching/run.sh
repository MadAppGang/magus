#!/bin/bash
# Coaching pipeline E2E test suite
# Thin wrapper - coaching tests use their own runner (not claudish-based)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/run-tests.sh" "$@"
