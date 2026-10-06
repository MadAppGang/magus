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
    - `/code-search:setup` — ripgrep shim, MCP server check, and search-engine report
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
  <rule id="plugin-deps-are-not-stack">
    Plugin dependencies (step 3b) belong to the plugins installed in Claude
    Code, not to this repository. A plugin whose binary is missing has an MCP
    server that does not connect and a hook that does not run — here and in
    every other repo. So a missing plugin dependency is NEVER "unrelated to
    this project", never left out of the report, and never skipped because
    the stack does not use it. Step 3b runs in every repository, whatever
    its stack.
  </rule>
</constraints>

<instructions>
  Run steps 1-4, including 3b, without pausing. Stop at the gate in step 5.
  Then run 6-10.

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
    for t in bun node go cargo python3 uv docker gh jq rg; do
      command -v "$t" >/dev/null 2>&1 && echo "have $t" || echo "MISSING $t"
    done
    ```

    Extend the list with anything step 1 implied (for example `air` for a Go
    hot-reload project, `wrangler` for a Cloudflare Worker). A tool named in a
    CI workflow but absent locally is a finding worth reporting.

    This list is the project's stack only. Never add a plugin's binary to it —
    that is step 3b.
  </step>

  <step number="3b" name="Plugin dependencies" mandatory="true">
    Not optional, and not about the stack (rule `plugin-deps-are-not-stack`).
    Run both parts in every repository, even when you already noticed missing
    binaries elsewhere — what you noticed is not the list.

    This command holds no list of plugin dependencies. Each plugin declares
    its own in its manifest, and magus-cli is the one thing that reads them.
    Never compose the list yourself from memory, from `.mcp.json`, or from a
    session-start banner. Run magus.

    **Part 1 — is magus-cli installed?**

    ```bash
    command -v magus || echo "MAGUS-CLI MISSING"
    command -v bun || echo "no bun"
    command -v npm || echo "no npm"
    ```

    If `magus` is missing, this is the first line of the step-4 report, in
    these words: "magus-cli is not installed — it owns plugin dependency
    checks, so nothing can say which plugin dependencies are missing until it
    is." Its install command is `bun add -g magus-cli`; when `bun` is absent
    and `npm` is present, `npm i -g magus-cli`. When both are absent there is
    no command to offer: say "install Bun from https://bun.sh, then re-run
    /setup:project". Skip part 2 — step 5b offers the install, and part 2
    runs after it.

    **Part 2 — what is missing?** When `magus` is present:

    ```bash
    magus doctor --json
    ```

    Exit 1 means problems remain: it is the finding, not a failed command.
    stdout is one JSON document. Carry into the step-4 report, verbatim:

    - every `deps[]` entry whose `status` is not `present`: its `name`,
      `status`, `requiredBy`, and `fix.text`, marked `[sudo]` when
      `fix.escalation` is `sudo`
    - every `unfixable[]` entry (`name` — `why`)
    - every `plugins_needing_update[]` and `invalid[]` entry
    - every `pathAdvice[]` entry (`rcLine`, to add to `rcFile`)

    If it prints no JSON document, its stderr is the finding — report it
    verbatim.
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

    PLUGIN DEPENDENCIES                                   (evidence: magus doctor --json)
      magus-cli:    installed | NOT INSTALLED — <install command>
      Missing:      <name> (<requiredBy>) — fix: <fix.text>    one line each, [sudo] marked
      Unfixable:    <name> — <why>
      Needs update: <plugin> — <message>
      PATH:         add <rcLine> to <rcFile>
    ```

    The PLUGIN DEPENDENCIES block is always printed. With nothing missing it
    says "all present" — it is never omitted.

    Recommend plugins only where the stack justifies them, and give the
    reason. A recommendation with no reason is noise:

    | Stack signal | Plugin | Reason |
    |---|---|---|
    | any repo over a few thousand files | `code-search@magus` | semantic search and call-graph navigation |
    | any repo | `dev@magus` | stack detection and specialist agent routing |
    | Bun or TypeScript | `bunjs@magus` | task-shaped Bun skills, zero listing cost |
    | Go | `go@magus` | go-tui skill for Charm-stack terminal UIs |
    | React or any web UI | `designer@magus` | pixel-diff design validation |
    | browser automation or E2E | `browser-use@magus` | MCP tools that drive a real headless browser |
    | long-running processes, TDD, dev servers | `terminal@magus` | tmux-backed interactive terminal |
    | multi-model review wanted | `multimodel@magus` + `claudish@magus` | team voting and delegation |

    **Weigh the listing budget before recommending.** Every plugin whose skills
    are model-invocable eats the shared per-turn budget — one budget across
    everything installed, 8,000 chars at a 200k-token context and larger on a
    bigger window. Check the cost before proposing:

    ```bash
    claude plugin details <name> 2>/dev/null
    ```

    If the project is already near or over the cap, say so, and prefer plugins
    whose skills carry `disable-model-invocation: true`. `/setup:index-skills`
    gives the current number.
  </step>

  <step number="5" name="Approval gate" gate="true">
    STOP here. If the arguments contain `--dry-run`, print the plan and exit
    without installing anything. The plan includes the PLUGIN DEPENDENCIES
    block and the command that would install them:
    `magus doctor --fix --yes --json`.

    Otherwise ask up to three separate questions, in this order. 5b and 5c
    are their own AskUserQuestion calls, never folded into 5a.

    **5a — provisioning.** Use AskUserQuestion. Present the plan as discrete
    opt-in groups, because users routinely want the docs and not the installs:

    - question: "Provision this repository? Pick what to apply."
    - multiSelect: true
    - options:
      1. "Install recommended plugins" — lists them by name and scope
      2. "Wire MCP servers" — names which
      3. "Write framework references" — names the target file
      4. "Seed the knowledge base" — names the target files
      5. "Report missing tools only" — install commands printed, not run

    Apply only the selected groups. An unselected group is skipped in full,
    not partially applied. 5a does not decide plugin dependencies: 5b and 5c
    are asked whatever was picked here.

    **5b — magus-cli.** Ask only when step 3b found magus-cli missing and has
    an install command for it. Use AskUserQuestion:

    - question: "magus-cli is not installed, so nothing can check or install
      what your plugins need. Install magus-cli now? (<install command>)"
    - options: "Install magus-cli" — runs the command; "Skip" — your
      plugins' needs stay unchecked

    On "Install magus-cli", run the install command now. It is the one
    install that happens inside the gate, because the dependency list cannot
    be read without it. Then `command -v magus`. If it is still not found,
    the global bin directory is not on PATH: call it by full path —
    `"$(bun pm bin -g)/magus"`, or `"$(npm prefix -g)/bin/magus"` after an
    npm install — for the rest of this run, and report that directory as
    missing from PATH. Then run step 3b part 2, print its PLUGIN DEPENDENCIES
    block, and go on to 5c. On "Skip" or a failed install, report it and
    skip 5c and step 6b.

    **5c — plugin dependencies.** Ask whenever step 3b part 2 found at least
    one `deps[]` entry with `status` `missing`. First print every such entry's
    `fix.text` as a list, `[sudo]` marked, so the user sees what will run.
    Then use AskUserQuestion, single-select:

    - question: "Install the N missing plugin dependencies now? (magus doctor
      --fix --yes --json)" — N is that count
    - options: "Install" — magus-cli installs them; "Skip" — the fix lines
      stay in the report for the user to run

    This is a yes/no about the user's installed plugins. It is asked in every
    repository, whatever its stack.
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

  <step number="6b" name="Install plugin dependencies">
    Runs when 5c was answered "Install", whatever 5a selected — including
    "Report missing tools only". It runs after step 6, so the dependencies of
    plugins step 6 just installed are covered too. If step 6 installed any
    plugin, re-run `magus doctor --json` first and print every missing
    dependency that was not in the 5c list: it belongs to a plugin the user
    just chose, and it is installed with the rest.

    magus-cli is the only installer. Never run the `fix.text` lines yourself,
    one by one or as a fallback — `magus doctor --fix` orders the steps,
    verifies checksums, and resumes after an interruption.

    Always with `--json`: that form installs the plugin dependencies and
    nothing else, which is all 5c asked about. Without it, `--fix` also
    applies doctor's other repairs — profile state, CLAUDE.md and .gitignore
    conventions, model routing — and writes files the user never agreed to.

    Run it through the Bash tool **with `timeout: 600000` set on the Bash
    call itself**. The tool's default is 120000 ms (two minutes), which a
    system package install or a browser download routinely exceeds; 600000
    is the tool's maximum. Not a `timeout` shell wrapper, not a background
    run:

    ```bash
    magus doctor --fix --yes --json
    ```

    Exit 1 means something is still missing: it is the finding, not a failed
    command. Then, by how it ended:

    - **It finished** — stdout is one JSON document. Echo every `applied[]`
      entry, one line each: `name` — `status`, and for every status other
      than `installed` its `remedy`, verbatim (for example a step that needs
      a sudo password the tool cannot type), plus `dir` when it is set. Then
      print the PLUGIN DEPENDENCIES block of step 4 from the same document:
      its `deps[]`, `unfixable[]` and `pathAdvice[]` describe the machine
      after the install.
    - **The tool timed out** (its result says the command timed out). Do not
      run it again in the tool. Tell the user, verbatim, with this
      repository's absolute path in place of `<repo>`: "Installing plugin
      dependencies did not finish within the 10-minute tool limit. Finish it
      in your terminal: `magus doctor --fix --yes --json --project <repo>` —
      it installs only the plugin dependencies, resumes, and skips everything
      already installed."
    - **It failed** — no JSON document on stdout. Its stderr is the finding
      (for example another dependency install already running): report it
      verbatim. Never retry silently.

    After a timeout or a failure, re-run the check and report what is still
    missing, in the PLUGIN DEPENDENCIES shape of step 4:

    ```bash
    magus doctor --json
    ```

    Then tell the user: MCP servers whose binaries were just installed
    connect only after Claude Code restarts — and from a new terminal when a
    PATH line was reported, because Claude Code passes its own PATH to every
    MCP server it starts.
  </step>

  <step number="7" name="Wire MCP servers and delegate">
    Only if selected.

    Invoke the authoritative commands rather than reimplementing them:

    - If `dev@magus` is installed, run `/dev:setup` — it owns the routing table.
    - If `code-search@magus` is installed, run `/code-search:setup` — it
      owns the ripgrep shim, the MCP server check, and the engine report.

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
    Plugin deps:  <still missing, from the last magus doctor --json — or
                   "magus-cli not installed: <install command>">
    Next:         <the single most useful next command>
    ════════════════════════════════════════
    ```

    A plugin appears under `Installed` only if it showed up in
    `claude plugin list`. Never report an install you did not confirm.
    `Plugin deps` comes from the last `magus doctor --json` this run made
    (step 6b's, else step 3b's); it is never left blank.

    **A newly installed plugin's commands and skills are not available in this
    session.** Claude Code loads plugin components at session start. Tell the
    user to restart, or to run `/reload-plugins` if their build supports it.
    MCP servers whose binaries step 6b installed also connect only after a
    restart.
  </step>
</instructions>
