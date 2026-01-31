#!/bin/bash
# =============================================================================
# SESSION START HOOK - CHECK CLAUDEMEM STATUS (v0.4.0)
# =============================================================================
# This hook runs at the start of each Claude Code session.
# It checks if claudemem is installed and indexed for AST structural analysis.
# Provides guidance on v0.3.0 and v0.4.0 AST commands.
# Also performs session cleanup (TTL: 1 day).
# =============================================================================

set -euo pipefail

# =============================================================================
# HELPER: Output to FD3 if available, otherwise stdout
# =============================================================================
output_json() {
  if { true >&3; } 2>/dev/null; then
    cat >&3
  else
    cat
  fi
}

# =============================================================================
# SECTION 1: SESSION CLEANUP (TTL-based)
# =============================================================================

cleanup_old_sessions() {
  # Clean up session directories older than 1 day
  find /tmp -maxdepth 1 -name "analysis-*" -type d -mtime +1 -exec rm -rf {} + 2>/dev/null || true
  find /tmp -maxdepth 1 -name "plan-review-*" -type d -mtime +1 -exec rm -rf {} + 2>/dev/null || true
  find /tmp -maxdepth 1 -name "review-*" -type d -mtime +1 -exec rm -rf {} + 2>/dev/null || true
}

# Run cleanup
cleanup_old_sessions

# Count cleaned sessions (for reporting, doesn't block on errors)
CLEANED=$(find /tmp -maxdepth 1 -name "*-202*" -type d -mtime +1 2>/dev/null | wc -l | tr -d ' ') || CLEANED=0

# =============================================================================
# SECTION 2: CLAUDEMEM VERSION DETECTION
# =============================================================================

# Check if claudemem is installed
if ! command -v claudemem &>/dev/null; then
  output_json << 'EOF'
{
  "additionalContext": "⚠️ **claudemem not installed**\n\nThe code-analysis plugin uses AST structural analysis (v0.4.0). Install with:\n```bash\nnpm install -g claude-codemem\nclaudemem init       # Configure API key\nclaudemem index      # Build AST index\n```\n\nUntil indexed, Grep/Glob will work normally."
}
EOF
  exit 0
fi

# Get claudemem version
CLAUDEMEM_VERSION=$(claudemem --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)

if [ -z "$CLAUDEMEM_VERSION" ]; then
  output_json << 'EOF'
{
  "additionalContext": "⚠️ **claudemem version detection failed**\n\nCannot determine claudemem version. Reinstall:\n```bash\nnpm install -g claude-codemem@latest\n```"
}
EOF
  exit 0
fi

# Version comparison function (semantic versioning)
version_gte() {
  # Returns 0 if $1 >= $2
  local ver1=$1
  local ver2=$2

  if [ "$ver1" = "$ver2" ]; then
    return 0
  fi

  local IFS=.
  local i ver1arr=($ver1) ver2arr=($ver2)

  # Fill empty positions in ver1 with zeros
  for ((i=${#ver1arr[@]}; i<${#ver2arr[@]}; i++)); do
    ver1arr[i]=0
  done

  for ((i=0; i<${#ver1arr[@]}; i++)); do
    if [[ -z ${ver2arr[i]} ]]; then
      ver2arr[i]=0
    fi
    if ((10#${ver1arr[i]} > 10#${ver2arr[i]})); then
      return 0
    fi
    if ((10#${ver1arr[i]} < 10#${ver2arr[i]})); then
      return 1
    fi
  done
  return 0
}

# Check version
if ! version_gte "$CLAUDEMEM_VERSION" "0.3.0"; then
  output_json << EOF
{
  "additionalContext": "⚠️ **claudemem update required**\n\nCurrent: v$CLAUDEMEM_VERSION\nRequired: v0.3.0+\n\nUpdate with:\n\`\`\`bash\nnpm install -g claude-codemem@latest\nclaudemem index  # Rebuild index for AST features\n\`\`\`"
}
EOF
  exit 0
fi

# Determine feature availability
if version_gte "$CLAUDEMEM_VERSION" "0.4.0"; then
  # v0.4.0+ features available
  FEATURE_MESSAGE="✅ **claudemem v$CLAUDEMEM_VERSION** (v0.4.0+ features available)\n\nAvailable commands:\n- **v0.3.0**: \`map\`, \`symbol\`, \`callers\`, \`callees\`, \`context\`, \`search\`\n- **v0.4.0**: \`dead-code\`, \`test-gaps\`, \`impact\`"
else
  # Only v0.3.0 features
  FEATURE_MESSAGE="💡 **claudemem v$CLAUDEMEM_VERSION** (v0.3.0)\n\nAvailable commands:\n- \`map\`, \`symbol\`, \`callers\`, \`callees\`, \`context\`, \`search\`\n\n**Upgrade to v0.4.0+ for:**\n- \`dead-code\` - Find unused symbols\n- \`test-gaps\` - Find untested high-importance code\n- \`impact\` - BFS traversal for impact analysis\n\nUpgrade: \`npm update -g claude-codemem\`"
fi

# =============================================================================
# SECTION 3: INDEX STATUS CHECK
# =============================================================================

# Check claudemem status
STATUS_OUTPUT=$(claudemem status 2>/dev/null || echo "")

# Check if indexed
if ! echo "$STATUS_OUTPUT" | grep -qE "[0-9]+ (chunks|symbols)"; then
  output_json << EOF
{
  "additionalContext": "$FEATURE_MESSAGE\n\n⚠️ **Not indexed for this project**\n\nRun \`claudemem index\` to enable AST analysis."
}
EOF
  exit 0
fi

# Get index stats
SYMBOL_COUNT=$(echo "$STATUS_OUTPUT" | grep -oE "[0-9]+ symbols" | head -1 || echo "$STATUS_OUTPUT" | grep -oE "[0-9]+ chunks" | head -1 || echo "indexed")

# =============================================================================
# SECTION 4: SUCCESS MESSAGE
# =============================================================================

# Build cleanup message if any were cleaned
CLEANUP_MSG=""
if [ "$CLEANED" -gt 0 ]; then
  CLEANUP_MSG="\n\n🧹 Cleaned up $CLEANED old session directories"
fi

# Indexed and ready
output_json << EOF
{
  "additionalContext": "$FEATURE_MESSAGE\n\nAST index: $SYMBOL_COUNT$CLEANUP_MSG\n\nGrep/rg/find intercepted and replaced with AST analysis."
}
EOF

exit 0
