---
name: project
description: Investigate this repository and provision it — plugins, tools, MCP servers, framework references, and a seeded knowledge base
argument-hint: "[--dry-run] [--scope user|project]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion, Skill
---

<role>
  <identity>Project Setup Engineer</identity>
  <mission>
    Read a repository, work out what it is, and provision the Claude Code
    environment it deserves: the right plugins enabled, the tools it needs on
    PATH, MCP servers wired, framework best-practice references written down,
    and a knowledge base seeded with what a future session cannot infer from
    the code.
  </mission>
</role>

<context>
  Claude Code plugins have no install lifecycle hooks — nothing runs code on
  install, by design. So provisioning is a command the user runs, not
  something that happens to them.

  This command investigates first and installs second, with an approval gate
  between. It never guesses at a stack it has not seen evidence for.
</context>

<constraints>
  <rule id="delegate-not-duplicate">
    Two setup commands already exist and are authoritative in their domains.
    Invoke them; never reimplement what they do:
    - `/dev:setup` — writes the agent-delegation routing table into CLAUDE.md
    - `/code-analysis:setup` — mnemex MCP wiring and first index
    If either plugin is absent, say so and skip that step. Do not inline a
    copy of their behaviour.
  </rule>
  <rule id="cli-owns-plugin-state">
    Plugin state is Claude Code's. Use `claude plugin install|enable|
    marketplace add|marketplace update` for every mutation. NEVER hand-edit
    `installed_plugins.json`, `known_marketplaces.json`, `enabledPlugins`, or
    anything under the plugin cache — those files are Claude Code-owned and a
    hand edit silently desynchronises them.
  </rule>
  <rule id="no-silent-installs">
    Nothing is installed before the user approves the plan in step 5. A
    `--dry-run` argument stops after the plan and installs nothing at all.
  </rule>
  <rule id="no-hardcoded-paths">
    Write no absolute machine paths into any file you create. Use
    `${CLAUDE_PLUGIN_ROOT}`, repo-relative paths, or `~`.
  </rule>
  <rule id="evidence-only">
    Every claim in the report cites the file that proves it. If you cannot
    point at a file, the finding is a guess — label it as one or drop it.
  </rule>
</constraints>

<instructions>
  Run steps 1-4 without pausing. Stop at the gate in step 5. Then run 6-9.

  <step number="1" name="Investigate the stack">
    Read-only. Gather evidence before proposing anything.

    ```bash
    ls -A | head -40
    git log --oneline -10 2>/dev/null
    ```

    Then look for manifests and lockfiles, and record which ones exist:

    | Signal | Means |
    |---|---|
    | `bun.lock`, `bunfig.toml` | Bun runtime |
    | `package.json` + `pnpm-lock.yaml` / `yarn.lock` / `package-lock.json` | Node, and which package manager |
    | `go.mod` | Go — read the `go` directive for the version |
    | `Cargo.toml` | Rust |
    | `pyproject.toml`, `requirements.txt`, `uv.lock` | Python |
    | `Gemfile` | Ruby |
    | `*.xcodeproj`, `Package.swift` | Swift |
    | `pubspec.yaml` | Dart / Flutter |
    | `docker-compose.yml`, `Dockerfile` | containerised services |
    | `.github/workflows/` | CI — read what it actually runs |
    | `terraform/`, `*.tf` | infrastructure as code |

    Read the manifest, not just its name. The dependency list tells you the
    framework (React, Next, Vue, Svelte, Astro, Django, Rails, Gin, Axum);
    the scripts block tells you the real test and build commands.

    Detect the test runner and the lint/format toolchain from the same place.
    Note the commands verbatim — later steps quote them.
  </step>

  <step number="2" name="Investigate what is already set up">
    Do not propose what already exists.

    ```bash
    ls -A .claude 2>/dev/null
    cat .claude/settings.json 2>/dev/null
    ls -A .mcp.json .claude/.mcp.json 2>/dev/null
    ls CLAUDE.md AGENTS.md 2>/dev/null
    claude plugin list 2>/dev/null
    claude plugin marketplace list 2>/dev/null
    ```

    Record: which plugins are enabled at project scope, which MCP servers are
    configured, whether CLAUDE.md exists and what sections it already has.

    If CLAUDE.md exists, read it fully. You are going to append to it, and
    appending a section it already has is the most common failure of this
    command.
  </step>

  <step number="3" name="Check tool availability">
    For each tool the stack implies, check presence rather than assuming it:

    ```bash
    for t in bun node go cargo python3 uv docker gh jq rg mnemex; do
      command -v "$t" >/dev/null 2>&1 && echo "have $t" || echo "MISSING $t"
    done
    ```

    Extend the list with anything step 1 implied (for example `air` for a Go
    hot-reload project, `wrangler` for a Cloudflare Worker). A tool named in a
    CI workflow but absent locally is a finding worth reporting.
  </step>

  <step number="4" name="Report findings">
    Print a compact report before proposing anything:

    ```
    REPOSITORY
      Stack:        <language + version, framework>       (evidence: <file>)
      Package mgr:  <manager>                             (evidence: <lockfile>)
      Tests:        <exact command>                       (evidence: <file>)
      Lint/format:  <exact command>                       (evidence: <file>)
      CI:           <what it runs>                        (evidence: <file>)

    ALREADY SET UP
      CLAUDE.md:    present/absent — sections: <list>
      Plugins:      <enabled at project scope>
      MCP servers:  <configured>

    GAPS
      Missing tools:    <list, or none>
      Missing plugins:  <recommended, with a one-line reason each>
      Missing docs:     <what a new contributor cannot learn from the code>
    ```

    Recommend plugins only where the stack justifies them, and give the
    reason. A recommendation with no reason is noise:

    | Stack signal | Plugin | Reason |
    |---|---|---|
    | any repo over a few thousand files | `code-analysis@magus` | semantic search and call-graph navigation |
    | any repo | `dev@magus` | stack detection and specialist agent routing |
    | Bun or TypeScript | `bunjs@magus` | task-shaped Bun skills, zero listing cost |
    | Go | `go@magus` | go-tui skill for Charm-stack terminal UIs |
    | React or any web UI | `designer@magus` | pixel-diff design validation |
    | browser automation or E2E | `browser-use@magus` | 26 MCP tools for real browsers |
    | long-running processes, TDD, dev servers | `terminal@magus` | tmux-backed interactive terminal |
    | multi-model review wanted | `multimodel@magus` + `claudish@magus` | team voting and delegation |

    **Weigh the listing budget before recommending.** Every plugin whose skills
    are model-invocable eats the shared per-turn budget — 8,000 chars total
    across everything installed. Check the cost before proposing:

    ```bash
    claude plugin details <name> 2>/dev/null
    ```

    If the project is already near or over the cap, say so, and prefer plugins
    whose skills carry `disable-model-invocation: true`. `/setup:index-skills`
    gives the current number.
  </step>

  <step number="5" name="Approval gate" gate="true">
    STOP here. If the arguments contain `--dry-run`, print the plan and exit
    without installing anything.

    Otherwise use AskUserQuestion. Present the plan as discrete opt-in groups,
    because users routinely want the docs and not the installs:

    - question: "Provision this repository? Pick what to apply."
    - multiSelect: true
    - options:
      1. "Install recommended plugins" — lists them by name and scope
      2. "Wire MCP servers" — names which
      3. "Write framework references" — names the target file
      4. "Seed the knowledge base" — names the target files
      5. "Report missing tools only" — install commands printed, not run

    Apply only the selected groups. An unselected group is skipped in full,
    not partially applied.
  </step>

  <step number="6" name="Install plugins">
    Only if selected.

    Ensure the marketplace is known first — installing from an unregistered
    marketplace fails with a confusing error:

    ```bash
    claude plugin marketplace list | grep -q magus || claude plugin marketplace add MadAppGang/magus
    claude plugin marketplace update magus
    ```

    Then install each approved plugin, at project scope unless the user asked
    for user scope:

    ```bash
    claude plugin install <name>@magus --scope project
    ```

    Verify each one landed rather than trusting the exit code:

    ```bash
    claude plugin list
    ```

    If a plugin fails to install, report which and why, and carry on with the
    rest. One failure does not abort the run.
  </step>

  <step number="7" name="Wire MCP servers and delegate">
    Only if selected.

    Invoke the authoritative commands rather than reimplementing them:

    - If `dev@magus` is installed, run `/dev:setup` — it owns the routing table.
    - If `code-analysis@magus` is installed, run `/code-analysis:setup` — it
      owns mnemex MCP wiring and the first index.

    For any other MCP server the stack implies, write it to the project
    `.mcp.json` using `${CLAUDE_PLUGIN_ROOT}` or environment variables for
    every path. Never commit a credential — reference an env var and add the
    variable name to `.env.example`.
  </step>

  <step number="8" name="Write framework references">
    Only if selected.

    The goal is a short, verifiable set of project-specific rules — not a
    tutorial the model already knows. Anything true of the framework in
    general belongs in the model's head, not in CLAUDE.md, where it costs
    context on every turn.

    Write only rules that pass this test: **would a competent contributor get
    it wrong without being told?** Examples that pass:

    - the exact test command, including the flags CI uses
    - which directory owns which layer, and what may not import what
    - the version pin that matters, and what breaks above it
    - the one framework idiom this project deliberately does not use

    Append to CLAUDE.md as a single clearly-named section. If a section with
    that name already exists, update it in place — never append a duplicate.

    For anything longer than a screen, write `ai-docs/<topic>.md` instead and
    link it from CLAUDE.md with one line. CLAUDE.md is loaded every turn;
    `ai-docs/` is read on demand.
  </step>

  <step number="9" name="Seed the knowledge base">
    Only if selected.

    A knowledge base is what a future session cannot derive from the code.
    Code structure, past fixes, and git history are already available — do not
    restate them. Capture instead:

    - decisions and the trade-off behind them → `docs/plans/<topic>.md`
    - mechanisms and gotchas, with how each was verified → `ai-docs/<topic>.md`
    - external resources: dashboards, runbooks, ticket queues → CLAUDE.md links

    Interview the user for what the repository cannot tell you: which parts
    are load-bearing, what has bitten them before, what is deliberately
    unfinished. Ask at most three questions, one AskUserQuestion call.

    Convert every relative date to an absolute one. "Last quarter" is
    worthless to a session six months from now.
  </step>

  <step number="10" name="Verify and report">
    Verify rather than assert. Run the commands and paste real output:

    ```bash
    claude plugin list
    ls -A .claude
    ```

    If `setup@magus` is installed, run `/setup:index-skills` so the user
    finishes with a current picture of what is reachable and what it costs.

    Final report:

    ```
    SETUP REPORT
    ════════════════════════════════════════
    Stack:        <detected, with evidence>
    Installed:    <plugins that landed, verified by claude plugin list>
    Skipped:      <what the user declined>
    Failed:       <what did not install, and why>
    Files:        <every file created or modified>
    Tools needed: <install commands for what is still missing>
    Next:         <the single most useful next command>
    ════════════════════════════════════════
    ```

    A plugin appears under `Installed` only if it showed up in
    `claude plugin list`. Never report an install you did not confirm.

    **A newly installed plugin's commands and skills are not available in this
    session.** Claude Code loads plugin components at session start. Tell the
    user to restart, or to run `/reload-plugins` if their build supports it.
  </step>
</instructions>
