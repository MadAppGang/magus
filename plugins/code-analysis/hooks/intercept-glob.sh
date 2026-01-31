#!/bin/bash
# =============================================================================
# INTERCEPT GLOB → WARN ON BROAD PATTERNS (v0.3.0)
# =============================================================================
# This hook warns when using broad glob patterns (like **/*.ts) that suggest
# code discovery. Suggests claudemem map command as alternative.
# Does NOT block - just provides helpful guidance.
#
# v0.3.0 Update: Recommends map command for structural overview
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

# Detect broad patterns: **/*.ts, **/*.py, src/**/* , **/*, etc.
# These suggest code discovery rather than specific file lookup
if ! echo "$PATTERN" | grep -qE '^\*\*/|\*\*[^/]*$|/\*\*/|\*\*$'; then
  # Specific pattern like "src/components/*.tsx" - allow without warning
  exit 0
fi

# Check if claudemem is installed and indexed
if ! command -v claudemem &>/dev/null; then
  exit 0
fi

if ! claudemem status 2>/dev/null | grep -qE "[0-9]+ (chunks|symbols)"; then
  # Not indexed - no warning needed
  exit 0
fi

# === BROAD PATTERN DETECTED - PROVIDE GUIDANCE ===

PATTERN_ESCAPED=$(echo "$PATTERN" | jq -Rs .)

output_json << EOF
{
  "additionalContext": "💡 **Broad glob pattern detected:** ${PATTERN_ESCAPED}\n\nIf you're exploring code structure, use AST analysis:\n\`\`\`bash\nclaudemem --agent map                  # Full structure with PageRank\nclaudemem --agent map \"controllers\"   # Focused on area\n\`\`\`\n\nHigh PageRank = architectural pillars. Understand these first.\n\nGlob allowed for file listing. Use claudemem for structural understanding."
}
EOF

# Allow glob to proceed (soft warning only)
exit 0
