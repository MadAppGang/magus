#!/bin/bash
# =============================================================================
# INTERCEPT GREP → REPLACE WITH CLAUDEMEM AST ANALYSIS (v0.3.0)
# =============================================================================
# This hook intercepts the Grep tool and replaces it with claudemem commands.
# When claudemem is indexed, Grep is blocked and AST results are returned.
# When claudemem is not indexed, Grep is allowed with a warning.
#
# v0.3.0 Update: Uses map/symbol commands for structural analysis
# =============================================================================

set -euo pipefail

# Helper: Output to FD3 if available, otherwise stdout
output_json() {
  if { true >&3; } 2>/dev/null; then
    cat >&3
  else
    cat
  fi
}

# Read tool input from stdin
TOOL_INPUT=$(cat)
PATTERN=$(echo "$TOOL_INPUT" | jq -r '.pattern // empty')

# Skip if empty pattern
if [ -z "$PATTERN" ]; then
  exit 0
fi

# Check if claudemem is installed
if ! command -v claudemem &>/dev/null; then
  # Not installed - allow grep
  exit 0
fi

# Check if claudemem is indexed
STATUS_OUTPUT=$(claudemem status 2>/dev/null || echo "")
if ! echo "$STATUS_OUTPUT" | grep -qE "[0-9]+ (chunks|symbols)"; then
  # Not indexed - allow grep with warning
  output_json << 'EOF'
{
  "additionalContext": "⚠️ **claudemem not indexed** - Grep allowed as fallback.\n\nFor AST structural analysis, run:\n```bash\nclaudemem index\n```"
}
EOF
  exit 0
fi

# === CLAUDEMEM IS INDEXED - REPLACE GREP ===

# Determine best command based on pattern
# If pattern looks like a symbol name (CamelCase, snake_case), use symbol command
# Otherwise use map command

RESULTS=""
COMMAND_USED=""

# Check if pattern looks like a specific symbol name
if echo "$PATTERN" | grep -qE '^[A-Z][a-zA-Z0-9]*$|^[a-z][a-zA-Z0-9]*$|^[a-z_]+$'; then
  # Pattern looks like a symbol name - try symbol lookup first
  SYMBOL_RESULT=$(claudemem --agent symbol "$PATTERN" 2>/dev/null || echo "")

  if [ -n "$SYMBOL_RESULT" ] && [ "$SYMBOL_RESULT" != "No results found" ]; then
    RESULTS="$SYMBOL_RESULT"
    COMMAND_USED="symbol"
  fi
fi

# Fallback to map if symbol didn't find anything
if [ -z "$RESULTS" ]; then
  RESULTS=$(claudemem --agent map "$PATTERN" 2>/dev/null || echo "No results found")
  COMMAND_USED="map"
fi

# Escape special characters for JSON
RESULTS_ESCAPED=$(echo "$RESULTS" | jq -Rs .)
PATTERN_ESCAPED=$(echo "$PATTERN" | jq -Rs .)

# Return results and block grep
output_json << EOF
{
  "additionalContext": "🔍 **CLAUDEMEM AST ANALYSIS** (Grep intercepted)\n\n**Query:** ${PATTERN_ESCAPED}\n**Command:** claudemem --agent ${COMMAND_USED} \"$PATTERN\"\n\n${RESULTS_ESCAPED}\n\n---\n✅ AST structural analysis complete.\n\n**v0.3.0 Commands (Available Now):**\n- \`claudemem --agent symbol <name>\` → Exact location\n- \`claudemem --agent callers <name>\` → What calls this?\n- \`claudemem --agent callees <name>\` → What does this call?\n- \`claudemem --agent context <name>\` → Full call chain\n\n**v0.4.0+ Commands (Check Version):**\n- \`claudemem --agent dead-code\` → Find unused symbols\n- \`claudemem --agent test-gaps\` → Find untested code\n- \`claudemem --agent impact <name>\` → Full impact analysis\n\n**Check version:** \`claudemem --version\`",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Grep replaced with claudemem AST analysis. Results provided in context above. Use v0.3.0 commands (callers/callees/context) for navigation. Use v0.4.0+ commands (dead-code/test-gaps/impact) if available for code analysis."
  }
}
EOF

exit 0
