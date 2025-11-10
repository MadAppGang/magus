# Claudish

> Run Claude Code with OpenRouter models via local proxy

**Claudish** (Claude-ish) is a CLI tool that allows you to run Claude Code with any OpenRouter model by proxying requests through a local Anthropic API-compatible server.

## Features

- ✅ **One-shot execution** - Fresh proxy for each run
- ✅ **Real-time streaming** - See Claude Code output as it happens
- ✅ **Parallel runs** - Each instance gets isolated proxy
- ✅ **Autonomous mode** - Bypass all prompts with flags
- ✅ **Context inheritance** - Runs in current directory with same `.claude` settings
- ✅ **Multiple models** - 5 prioritized OpenRouter models

## Installation

### Prerequisites

- [Bun](https://bun.sh) - JavaScript runtime
- [Claude Code](https://claude.com/claude-code) - Claude CLI must be installed
- [OpenRouter API Key](https://openrouter.ai/keys) - Free tier available

### Install Claudish

```bash
cd mcp/claudish
bun install
bun run build
bun link
```

This makes `claudish` globally available in your terminal.

## Quick Start

### 1. Set up environment

```bash
# Copy example env file
cp .env.example .env

# Add your OpenRouter API key
export OPENROUTER_API_KEY=sk-or-v1-...
```

### 2. Run claudish

```bash
# Basic usage (auto-approve enabled by default)
claudish "implement user authentication"

# Use specific model
claudish --model openai/gpt-5-codex "add tests"

# Fully autonomous mode (auto-approve + dangerous)
claudish --dangerous "refactor codebase"
```

## Usage

### Basic Syntax

```bash
claudish [OPTIONS] <claude-args...>
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-m, --model <model>` | OpenRouter model to use | `x-ai/grok-code-fast-1` |
| `-p, --port <port>` | Proxy server port | Random (3000-9000) |
| `--no-auto-approve` | Disable auto-approve (require prompts) | Auto-approve is **enabled** by default |
| `--dangerous` | Pass `--dangerouslyDisableSandbox` | `false` |
| `--list-models` | List available models | - |
| `-h, --help` | Show help message | - |

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key | ✅ Yes |
| `CLAUDISH_MODEL` | Default model to use | ❌ No |
| `CLAUDISH_PORT` | Default proxy port | ❌ No |

## Available Models

Claudish supports 5 OpenRouter models in priority order:

1. **x-ai/grok-code-fast-1** (Default)
   - Fast coding-focused model from xAI
   - Best for quick iterations

2. **openai/gpt-5-codex**
   - Advanced coding model from OpenAI
   - Best for complex implementations

3. **minimax/minimax-m2**
   - High-performance model from MiniMax
   - Good for general coding tasks

4. **zhipu-ai/glm-4.6**
   - Advanced model from Zhipu AI
   - Good for multilingual code

5. **qwen/qwen3-vl-235b-a22b-instruct**
   - Vision-language model from Alibaba
   - Best for UI/visual tasks

List models anytime with:

```bash
claudish --list-models
```

## Examples

### Basic Usage

```bash
# Simple prompt
claudish "fix the bug in user.ts"

# Multi-word prompt
claudish "implement user authentication with JWT tokens"
```

### With Specific Model

```bash
# Use Grok for fast coding
claudish --model x-ai/grok-code-fast-1 "add error handling"

# Use GPT-5 Codex for complex tasks
claudish --model openai/gpt-5-codex "refactor entire API layer"

# Use Qwen for UI tasks
claudish --model qwen/qwen3-vl-235b-a22b-instruct "implement dashboard UI"
```

### Autonomous Mode

Auto-approve is **enabled by default**. For fully autonomous mode, add `--dangerous`:

```bash
# Basic usage (auto-approve already enabled)
claudish "delete unused files"

# Fully autonomous (auto-approve + dangerous sandbox disabled)
claudish --dangerous "install dependencies"

# Disable auto-approve if you want prompts
claudish --no-auto-approve "make important changes"
```

### Custom Port

```bash
# Use specific port
claudish --port 3000 "analyze codebase"

# Or set default
export CLAUDISH_PORT=3000
claudish "your task"
```

### Passing Claude Flags

```bash
# Verbose mode
claudish "debug issue" --verbose

# Custom working directory
claudish "analyze code" --cwd /path/to/project

# Multiple flags
claudish --model openai/gpt-5-codex "task" --verbose --debug
```

## How It Works

### Architecture

```
claudish "your prompt"
    ↓
1. Parse arguments (--model, --no-auto-approve, --dangerous, etc.)
2. Find available port (random or specified)
3. Start local proxy on http://127.0.0.1:PORT
4. Spawn: claude --auto-approve --env ANTHROPIC_BASE_URL=http://127.0.0.1:PORT
5. Proxy translates: Anthropic API → OpenRouter API
6. Stream output in real-time
7. Cleanup proxy on exit
```

### Request Flow

```
Claude Code → Anthropic API format → Local Proxy → OpenRouter API format → OpenRouter
                                         ↓
Claude Code ← Anthropic API format ← Local Proxy ← OpenRouter API format ← OpenRouter
```

### Parallel Runs

Each `claudish` invocation:
- Gets a unique random port
- Starts isolated proxy server
- Runs independent Claude Code instance
- Cleans up on exit

This allows multiple parallel runs:

```bash
# Terminal 1
claudish --model x-ai/grok-code-fast-1 "task A"

# Terminal 2
claudish --model openai/gpt-5-codex "task B"

# Terminal 3
claudish --model minimax/minimax-m2 "task C"
```

## Development

### Project Structure

```
mcp/claudish/
├── src/
│   ├── index.ts           # Main entry point
│   ├── cli.ts             # CLI argument parser
│   ├── proxy-server.ts    # Anthropic API proxy
│   ├── api-translator.ts  # API format translation
│   ├── claude-runner.ts   # Claude CLI runner
│   ├── port-manager.ts    # Port utilities
│   ├── config.ts          # Constants and defaults
│   └── types.ts           # TypeScript types
├── tests/                 # Test files
├── package.json
├── tsconfig.json
└── biome.json
```

### Build & Test

```bash
# Install dependencies
bun install

# Development mode
bun run dev "test prompt"

# Build
bun run build

# Lint
bun run lint

# Format
bun run format

# Type check
bun run typecheck

# Run tests
bun test
```

### Install Globally

```bash
# Link for global use
bun run install:global

# Now use anywhere
claudish "your task"
```

## Troubleshooting

### "Claude Code CLI is not installed"

Install Claude Code:

```bash
npm install -g claude-code
# or visit: https://claude.com/claude-code
```

### "OPENROUTER_API_KEY environment variable is required"

Set your API key:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
```

Or add to your shell profile (`~/.zshrc`, `~/.bashrc`):

```bash
echo 'export OPENROUTER_API_KEY=sk-or-v1-...' >> ~/.zshrc
source ~/.zshrc
```

### "No available ports found"

Specify a custom port:

```bash
claudish --port 3000 "your task"
```

Or increase port range in `src/config.ts`.

### Proxy errors

Check OpenRouter API status:
- https://openrouter.ai/status

Verify your API key works:
- https://openrouter.ai/keys

## Comparison with Claude Code

| Feature | Claude Code | Claudish |
|---------|-------------|----------|
| Model | Anthropic models only | Any OpenRouter model |
| API | Anthropic API | OpenRouter API |
| Cost | Anthropic pricing | OpenRouter pricing |
| Setup | API key → direct | API key → proxy → OpenRouter |
| Speed | Direct connection | ~Same (local proxy) |
| Features | All Claude Code features | All Claude Code features |

**When to use Claudish:**
- ✅ Want to try different models (Grok, GPT-5, etc.)
- ✅ Need OpenRouter-specific features
- ✅ Prefer OpenRouter pricing
- ✅ Testing model performance

**When to use Claude Code:**
- ✅ Want latest Anthropic models only
- ✅ Need official Anthropic support
- ✅ Simpler setup (no proxy)

## Contributing

Contributions welcome! Please:

1. Fork the repo
2. Create feature branch: `git checkout -b feature/amazing`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing`
5. Open Pull Request

## License

MIT © MadAppGang

## Links

- **GitHub**: https://github.com/MadAppGang/claude-code
- **OpenRouter**: https://openrouter.ai
- **Claude Code**: https://claude.com/claude-code
- **Bun**: https://bun.sh

---

Made with ❤️ by [MadAppGang](https://madappgang.com)
