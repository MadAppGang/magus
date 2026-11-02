---
name: doctor
description: Checks that the aside CLI is installed, an account is signed in and the Aside hosts are reachable, and says what a task would run on. Changes nothing. Use before the first task or when one fails to start.
argument-hint: "[--host <h>]"
allowed-tools: Bash
---

# /aside:doctor

Answers one question: can a task run on Aside right now, and on which host and account? It reads and reports. It installs nothing, signs in to nothing and changes no setting.

Arguments: `$ARGUMENTS` (an optional `--host <id-or-name>` to check one host).

## Run these, one Bash call each

1. `aside --version`. If the command is not found, the CLI is not installed: say that it must be installed and stop. Do not run an installer.
2. `aside account list`. It lists the accounts and which one is active and signed in.
3. `aside host list`. It lists this machine and any remote hosts, and whether each is online.
4. `aside host status`, and with `--host`, `aside host status --host <h>`. It shows whether that Aside is running.

Never run `aside` with no task: it opens an interactive session. Never run `aside login`, `aside host use` or `aside account use`.

## Report

Lead with one line: ready, or what blocks.

- **Ready.** Name the version, the active account, the host a task would run on (the default one, or the one passed with `--host`), and whether that host is online.
- **Blocked.** Name the one thing and the one step. A machine not signed in to Aside is the user's step, and the CLI prints the command for it. A remote host that is offline or has remote control turned off needs the user to start Aside there; say so and do not suggest running on this machine instead.

Add nothing else.
