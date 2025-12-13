#!/bin/bash
# =============================================================================
# SESSION START HOOK - CHECK CLAUDISH STATUS FOR MULTI-MODEL VALIDATION
# =============================================================================
# This hook runs at the start of each Claude Code session.
# It checks if claudish is installed and available for external model validation.
# =============================================================================

set -euo pipefail

# Check if claudish is installed
if ! command -v claudish &>/dev/null; then
  cat << 'EOF' >&3
{
  "additionalContext": "## Multi-Model Validation: CLAUDISH NOT INSTALLED\n\n> Orchestration plugin detected\n\nThe orchestration plugin enables parallel multi-model validation with external AI models (Grok, Gemini, GPT-5, DeepSeek, etc.) via claudish.\n\n**Install claudish:**\n```bash\nnpm install -g claudish\n```\n\n**Configure:**\n```bash\nexport OPENROUTER_API_KEY=your-key  # Get at openrouter.ai/keys\n```\n\n**Available models:**\n```bash\nclaudish --top-models   # Top recommended models\nclaudish --free         # Free models\n```\n\nWithout claudish, multi-model validation skills will provide patterns but external execution won't work."
}
EOF
  exit 0
fi

# Check if OPENROUTER_API_KEY is set
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  cat << 'EOF' >&3
{
  "additionalContext": "## Multi-Model Validation: API KEY MISSING\n\n> Claudish installed but not configured\n\n**Configure OpenRouter API key:**\n```bash\nexport OPENROUTER_API_KEY=your-key\n```\n\nGet your API key at: https://openrouter.ai/keys\n\n**Then test:**\n```bash\nclaudish --top-models\n```"
}
EOF
  exit 0
fi

# Get available models for context
TOP_MODELS=$(claudish --top-models 2>/dev/null | head -5 || echo "Unable to fetch models")

cat << EOF >&3
{
  "additionalContext": "## Multi-Model Validation: READY\n\n> Claudish active with OpenRouter\n\n**Top recommended models:**\n\`\`\`\n${TOP_MODELS}\n\`\`\`\n\n**Quick commands:**\n- \`claudish --top-models\` - List top models\n- \`claudish --free\` - List free models\n- \`claudish --model MODEL \"prompt\"\` - Run single model\n\n**For parallel multi-model execution**, use the 4-Message Pattern from \`orchestration:multi-model-validation\` skill."
}
EOF

exit 0
