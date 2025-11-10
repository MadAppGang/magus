# Claudish Development Guide

Quick reference for development and debugging.

## 🚀 Quick Start Scripts

### Development (runs from TypeScript source - no build needed)

```bash
# Run with any arguments
bun run dev -- --help
bun run dev -- --list-models
bun run dev -- --interactive
bun run dev -- --model x-ai/grok-code-fast-1 "your prompt"

# Examples
bun run dev -- --interactive --model x-ai/grok-code-fast-1
bun run dev -- --no-auto-approve "your prompt here"
bun run dev -- --dangerous "refactor everything"
```

## 🔨 Build & Test Scripts

```bash
# Build for production
bun run build

# Run built version
./dist/index.js --help
./dist/index.js --interactive

# Run tests (comprehensive model identity tests)
bun run test

# Type checking
bun run typecheck

# Linting
bun run lint

# Formatting
bun run format
```

## 📦 Installation

```bash
# Build and install globally (makes 'claudish' command available)
bun run install

# Now 'claudish' works from anywhere
claudish --help
claudish --interactive
```

## 🐛 Debugging Workflows

### 1. Quick Interactive Test

```bash
# Fastest way to test changes
bun run dev -- --interactive
bun run dev -- --interactive --model x-ai/grok-code-fast-1
```

### 2. Test Model Selector

```bash
# Triggers interactive selector (no --model flag)
bun run dev -- "your prompt"
```

### 3. Test Specific Features

```bash
# Test auto-approve
bun run dev -- --no-auto-approve "test"

# Test dangerous mode
bun run dev -- --dangerous "test"

# Test custom port
bun run dev -- --port 3000 "test"

# Test specific model
bun run dev -- --model z-ai/glm-4.6 "test"
```

### 4. Debug Built Version

```bash
# Build first
bun run build

# Test built version
./dist/index.js --help
./dist/index.js --interactive
```

## 📋 Common Tasks

### Add Debug Logging

Edit source files and add:
```typescript
console.log('[DEBUG]', variable);
console.error('[ERROR]', error);
```

Then run:
```bash
bun run dev:interactive
```

### Test All Models

```bash
# Test each model
bun run dev -- --model x-ai/grok-code-fast-1 "test"
bun run dev -- --model openai/gpt-5-codex "test"
bun run dev -- --model z-ai/glm-4.6 "test"
bun run dev -- --model qwen/qwen3-vl-235b-a22b-instruct "test"
```

### Verify Tests Pass

```bash
# Run comprehensive model tests
bun run test

# Should show: 11 pass, 0 fail
```

### Check Build Size

```bash
bun run build

# Look for: "index.js  14.60 KB"
```

## 🎯 Example Development Session

```bash
# 1. Make changes to src/claude-runner.ts
vim src/claude-runner.ts

# 2. Test immediately (no build needed)
bun run dev -- --interactive

# 3. Run tests to verify
bun run test

# 4. Check types and lint
bun run typecheck
bun run lint

# 5. Build for production
bun run build

# 6. Test built version
./dist/index.js --interactive

# 7. Install globally if satisfied
bun run install
```

## 💡 Tips

1. **No Build Required for Dev**: `bun run dev:*` scripts run TypeScript directly
2. **Fast Iteration**: Edit → `bun run dev:interactive` → Test
3. **Use Specific Model Scripts**: `dev:grok`, `dev:gpt5` etc. for quick model testing
4. **Watch Mode**: `bun run test:watch` for TDD workflow
5. **Clean Start**: `bun run reset` if things get weird

## 📚 Script Categories

| Category | Scripts |
|----------|---------|
| **Development** | `dev`, `dev:interactive`, `dev:grok`, `dev:gpt5`, `dev:glm`, `dev:qwen`, `dev:claude`, `dev:test`, `dev:help`, `dev:list` |
| **Build** | `build`, `build:test` |
| **Run Built** | `start`, `start:interactive` |
| **Testing** | `test`, `test:comprehensive`, `test:integration`, `test:watch` |
| **Quality** | `typecheck`, `lint`, `lint:fix`, `format` |
| **Install** | `install:global`, `clean`, `reset` |

## 🔗 Related Files

- `package.json` - All scripts defined here
- `src/index.ts` - Main entry point
- `src/cli.ts` - Argument parsing
- `tests/` - Test files
- `.env` - API keys (create from `.env.example`)

## 🚀 Quick Reference

```bash
# Development
bun run dev -- [options]          # Run from source (instant)
bun run dev:grok                   # Interactive mode with Grok (quick start!)

# Testing
bun run test                       # Run tests
bun run typecheck                  # Type check
bun run lint                       # Lint code
bun run format                     # Format code

# Production
bun run build                      # Build dist/index.js
./dist/index.js [options]          # Run built version
bun run install                    # Build + install globally
```

---

**Happy developing! 🚀**
