---
name: framework-signals
description: Pass/fail/running/idle output markers for 15+ test frameworks, build tools, and deploy platforms. Use when polling terminal snapshots for test results, build completion, deploy status, or watcher state. Trigger on any test/build/deploy monitoring task, especially with jest, vitest, cargo, pytest, go test, bun test, webpack, vite, gradle, make, fly, vercel, railway.
version: 1.0.0
tags: [terminal, testing, build, deploy, signals, markers, output-parsing]
keywords: [jest, vitest, cargo watch, pytest, go test, bun test, webpack, vite, gradle, make, fly deploy, vercel, railway, pass, fail, running, idle, watcher, test output, build output]
plugin: terminal
---

# Framework Signal Reference

Copy-paste-ready signal strings for polling terminal snapshots. Consult this table whenever you need to know what text to look for — whether detecting completion, failure, or that a watcher is still initializing. For the state machine that drives the poll loop, see `terminal:tdd-workflow`. For watcher setup, see `terminal:terminal-interaction`.

> **Note on Vitest version sensitivity**: The `press a to rerun` idle signal applies to Vitest < 2.0. Vitest >= 2.0 may use different watch mode output — verify against the running version if results seem off.

## Test Watchers

| Framework | Pass Signal | Fail Signal | Still Running | Idle / Waiting |
|-----------|------------|-------------|---------------|----------------|
| **Jest** | `Tests: \d+ passed` or `All tests passed` | `FAIL ` (with space, line start) or `Tests: \d+ failed` | `RUNS ` or `Running \d+ tests` | `Waiting for file changes` |
| **Vitest** | `Tests: \d+ passed` or `✓ N tests` | `FAIL ` (line start) or `● Test` | `RUNS ` | `press a to rerun` or `Waiting...` |
| **Cargo watch** | `test result: ok.` | `test result: FAILED.` or `error[E` | `[Running 'cargo test']` | `[Watching` |
| **pytest-watch** | `N passed in Xs` or `passed in` | `FAILED ` (caps+space) or `N failed` | `Ding! Tests running...` | `Waiting for changes...` |
| **Go test** (with entr) | `ok ` (line start, space after) | `FAIL` (line start) or `--- FAIL:` | `--- RUN` | (no idle state — entr reruns on change) |
| **Bun test** | `✓ N tests` or `N pass` | `✗` or `N fail` | progress output | (no explicit idle marker) |
| **RSpec** | `N examples, 0 failures` | `N examples, N failures` | progress dots | (no watcher state) |

## Build Tools

| Tool | Success | Error | In Progress |
|------|---------|-------|-------------|
| **Cargo build** | `Finished dev [unoptimized` or `Finished release` | `error[E` or `error: aborting` | `Compiling ` (line start) |
| **Gradle** | `BUILD SUCCESSFUL in Xs` | `BUILD FAILED` or `> Task :{name} FAILED` | `> Task :` or `> Configure project :` |
| **Webpack** | `webpack compiled successfully` or `compiled successfully` | `Failed to compile.` or `ERROR in` | `compiling...` or `[webpack]` |
| **Vite HMR** | `[vite] hmr update /path` | `[vite] Internal server error:` | `[vite] page reload` or `[vite] connecting...` |
| **Vite build** | `built in Xs` or `dist/` output lines | `error during build` | `transforming...` |
| **Make** | silence + prompt return (exit 0) | `make: *** [target] Error N` or `recipe for target failed` | compiler invocations (`cc`, `g++`, `clang`) |
| **Go build** | silence + prompt return | `./file.go:\d+:\d+: error` or `build failed` | no output until done |

## Deploy Platforms

| Platform | Success | Failure | In Progress |
|----------|---------|---------|-------------|
| **Fly.io** | `Monitor: v{N} deployed successfully` or `live: N/N` | `Unhealthy allocations` or `live: 0/N` (stuck) | `==> Releasing v{N}` or `live: 0/N` changing |
| **Vercel** | `Production: https://` or `Ready!` | `Build failed` or non-zero exit | `Building`, progress output |
| **Railway** | `Deployment succeeded` or `Service is now live` | `Deployment failed` or `Build failed` | `Deploying...` or `Building...` |

> **Verification status**: Deploy platform strings are from knowledge, not live-verified against current CLI versions. Confirm against a live deploy before relying on these in production workflows.

## Local CI

| Tool | Success | Failure | In Progress |
|------|---------|---------|-------------|
| **act** | `✅  Success - step` or `Job succeeded` | `❌  Failure - step` or `Job failed` | `[Workflow/Job]   \| > step name` |
| **docker-compose** | `healthy` (in `docker ps`) or service-specific ready signal | timeout on health check | `Starting {service} ... done` |

> **Verification status**: `act` output patterns are from knowledge, not a live run. Verify with `act --list && act -j test -n` before shipping act-based workflows.

## Key Detection Principles

1. **Snapshot is point-in-time**: A spinner character means "still running now." A progress bar shows current completion percentage. Neither is the final result.
2. **Wait for the idle marker before declaring result**: Reading a Jest snapshot during `RUNS ` phase returns stale or incomplete data. Wait for `Waiting for file changes`.
3. **Make and Go build do not announce success**: Only errors are printed. Shell prompt return = success for these tools.
4. **After a file save, wait for "change detected"**: `[Running`, `RUNS`, `Ding!` — these confirm the watcher noticed the change. Don't read results until they appear.
5. **Prefer `tmux capture-pane` over `ht_take_snapshot` for failure parsing**: capture-pane returns plain text with ANSI already stripped by tmux. ht-mcp snapshots are also plain text (VT100-rendered).
