# Aside

Hands browser tasks to Aside, your own AI browser, through the `aside` CLI. Aside runs its own agent, and that agent already has your logins, cookies, browsing history and memory. The plugin teaches Claude to treat it like a subagent: write a real task brief, run `aside exec`, watch it, and report the result.

Aside versus browser-use: Aside's agent works in your own browser with your accounts and personal context. browser-use is a fresh Playwright Chromium that Claude drives step by step, with no personal state. Use Aside for work in your signed-in sites (Gmail, Slack, cloud consoles). Use browser-use for scraping, tests and UI debugging.

## Install

1. Install the plugin: `/plugin install aside@magus`.
2. Install the Aside CLI from Aside itself. This plugin never runs an installer.
3. Run `/aside:doctor`. It checks the CLI, the sign-in and the hosts, and changes nothing.

The only prerequisite is the aside CLI. The plugin keeps no settings and runs no scripts.

## Use

Ask Claude for something that lives in your accounts: "reply to Jack in Slack #develop", "find the invoice from Vercel in my mail". The `aside` skill loads and Claude briefs Aside's agent.

| Part | What it does |
|---|---|
| `aside` skill | Writes the task brief, runs `aside exec`, updates you about every 60 seconds, steers or stops the run, reports the result. `aside repl` for page debugging only. |
| `/aside:doctor` | Checks that the CLI is installed, an account is signed in and the hosts are reachable. |

With the terminal plugin inside tmux, the run happens in a split pane beside you and you see all of its output. Without it, the run goes to the background.

The CLI can drive the Aside on this machine or on another one, such as your laptop. Name the machine and Claude passes `--host`. An offline host stops the task; it never moves to this machine.

## Sign-ins

Aside manages sign-ins itself, with its own vault and the device you already signed in. Claude does not ask you to sign in before a task. It asks only when Aside is blocked and asks for help, such as a login code or a confirmation.

Claude never puts a password or secret in a task, never passes `--password`, and never runs the installer.

## Does it work

`benches/aside-*` holds the madbench benches that measure whether Claude picks Aside for the right work, briefs it well, and stays inside the rules above.
