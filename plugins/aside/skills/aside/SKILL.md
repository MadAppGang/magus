---
name: aside
description: Hands a task to Aside, the user's own browser and agent, through the aside CLI. Use when the work is in their accounts (my Slack, Gmail, Linear, GitHub, calendar) or they mention Aside; use browser-use for scraping and tests.
---

# Aside

Aside is the user's own AI browser. It runs its own agent, and that agent already has the user's logins, cookies, browsing history and a memory of who they are. Treat `aside exec` as spawning a subagent: you hand over a task and get a result back. You do not drive the browser click by click.

## Aside or browser-use

| | aside | browser-use |
|---|---|---|
| Who works the page | Aside's own agent, from your brief | you, tool call by tool call |
| Browser | the user's own, already signed in | a fresh Playwright Chromium |
| Pick it for | work in their accounts and personal context: Gmail, Slack, cloud consoles, "my" calendar | scraping, tests, UI debugging, anything that needs no personal state |

If the task needs no signed-in state, use browser-use.

## Run a task

1. Read the CLI's own guide once with `aside guide`. It is the authority on flags; this skill does not copy it.
2. Look for context before you ask the user. `aside memory search "<query>" --json` holds who they are, their people, projects and sites. Never edit memory files; to make Aside remember something, put it in a task.
3. Write the task as a real brief for a capable colleague who has not seen this conversation: the goal and the outcome you want, the exact names, places and text involved, constraints, and what to hand back (an answer, a URL, a confirmation). Say what to achieve, not which buttons to press. One task, one `aside exec`.
4. Run `aside exec [--host <h>] [--account <a>] [--profile <p>] "<brief>"`. The task text is the last argument, quoted.
5. While it runs, tell the user what is happening about every 60 seconds. Follow up on the same run with `aside session steer <id> "…"` to redirect it, `aside session queue <id> "…"` to add a step, `aside session resume <id> "…"` to continue a finished one, and `aside session stop <id>` to stop it. Do not start a second task for what a running one can still do.
6. Report the result in plain words with the final URL when there is one. The pane already showed the trace, so do not paste it.

## See it run

Run `aside exec` in a split pane beside the user so they can watch all of its output. This works when the terminal plugin is installed and the session is inside tmux: read `terminal:terminal-interaction` for the exact pane tools. When no pane is possible, run the command in the background with Bash and report when it finishes. That is fine; the result is the same, only the view differs.

## Which Aside

The CLI can drive the Aside on this machine or another one the user has, such as their laptop.

- `aside host list` shows the hosts, and `aside host profiles --host <h>` shows a host's browser profiles.
- With no flag, the default host runs the task. If the user names a machine, pass `--host`. For another account or profile, pass `--account` or `--profile`.
- Say which host and account the task will run on, so the user can stop it.
- A remote host must be online with remote control turned on. If the named host is offline, say so; do not move the task to this machine.
- Never run `aside host use` or `aside account use`. They change the user's default for every later command.

## Sign-ins and credentials

Aside manages sign-ins itself. It has its own vault and a device the user already signed in, so the agent can log in to sites without you. Do not ask the user to sign in, confirm or prepare anything before a task. Run it.

Ask the user only when Aside is actually blocked and asks for help, such as a login code, a two-factor prompt, a captcha or a confirmation only they can give. Then relay exactly what Aside needs, wait, and let it continue with `aside session resume`.

If the CLI itself says this machine is not signed in to Aside, that is a real block. Tell the user the command it printed and let them run it.

## Never

- never put a password, token or other secret in a task; say "use the saved login" and let Aside use its vault
- never pass `--password` to anything
- never run the installer; if the aside CLI is missing, tell the user it must be installed and stop
- never read cookies, storage or auth headers out of a signed-in page yourself

## Debugging a page

`aside repl` gives a JavaScript session with Playwright-style control of the tabs. Use it only when you must inspect a screenshot or the DOM yourself. Run `aside guide repl` first and read it. It needs a terminal, so run it in a pane. For anything else, use `aside exec`.

## Check it works

`/aside:doctor` checks the CLI, the sign-in and the hosts, and changes nothing. Run it when a task fails to start.
