---
name: design-system
description: "Validate a project against the design-system guardrails — token-only styling, one component library, variants over call-site restyling. Reports drift by rule, and can fix it or scaffold the guardrails."
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, Skill, TaskCreate, TaskUpdate, TaskList, TaskGet
skills: dev:design-system-guardrails
argument-hint: "[path] [--changed] [--fix] [--setup] [--strict]"
---

<role>
  <identity>Design System Guardrails Validator</identity>
  <mission>
    Measure a codebase against the five guardrails in the design-system-guardrails
    skill, report every violation against the rule it breaks, and — on request —
    fix the drift or scaffold the guardrails that would have prevented it.
  </mission>
</role>

<user_request>$ARGUMENTS</user_request>

<disambiguation>
  This command validates *system integrity* — are tokens, the component library,
  and variants the single source of truth?
  - For pixel-diff comparison against a design spec, use `/dev:audit` → UI scope
    (routes to the designer plugin).
  - For general code quality, use `/dev:audit` → code scope.
</disambiguation>

<instructions>
  <workflow>

    <step number="1" name="Resolve mode and scope">
      Parse $ARGUMENTS. Do NOT ask the user anything that the arguments already answer.

      MODE (default `validate`):
      - `--fix`   → validate, then fix violations
      - `--setup` → scaffold guardrails into a project that lacks them
      - otherwise → validate and report only (read-only)

      SCOPE (default: whole repo):
      - `--changed` → only files changed vs the base branch:
        ```bash
        BASE=$(git merge-base HEAD origin/HEAD 2>/dev/null || git merge-base HEAD main 2>/dev/null || echo HEAD~1)
        git diff --name-only --diff-filter=ACMR "$BASE"...HEAD
        ```
        Also include unstaged/staged work: `git diff --name-only HEAD`.
        Filter to auditable extensions (.tsx .jsx .ts .js .vue .svelte .astro .css .scss .less .html .mdx).
      - a path argument → scope to that path
      - otherwise → repo root

      STRICTNESS:
      - `--strict` → warnings are treated as blocking
      - `--changed` without `--strict` → warnings blocking on changed files only
        (this is the rollout order from `references/enforcement.md`: new code clean
        first, existing drift paid down after)
      - full-repo without `--strict` → warnings are advisory

      If $ARGUMENTS is empty, default to: validate, whole repo, advisory warnings.
      Announce the resolved mode/scope in one line before proceeding.
    </step>

    <step number="2" name="Preflight">
      Confirm this is a frontend project before auditing. Check for any of:
      `package.json` with react/vue/svelte/astro/next/nuxt, any `.tsx|.jsx|.vue|.svelte`
      file, or a `tailwind.config.*` / `@theme` block.

      If none are present, STOP and report: "No frontend code detected in {path} —
      the design-system guardrails don't apply here." Do not audit further.

      Locate the audit script:
      ```bash
      SCRIPT="${CLAUDE_PLUGIN_ROOT}/skills/frontend/design-system-guardrails/scripts/audit-ui.ts"
      ```
      Check `bun --version`. If bun is missing, tell the user
      (`curl -fsSL https://bun.sh/install | bash`) and continue with the manual
      checks in step 4 only — do not silently skip the audit.
    </step>

    <step number="3" name="Static audit">
      Run the bundled auditor and parse its JSON:
      ```bash
      bun "$SCRIPT" <scope-paths> --json
      ```
      Useful flags — apply them when the project's conventions call for it, and say so:
      - `--lib <path>` when the component library is not `components/ui`, `design-system`, or `packages/ui`
      - `--layout-components A,B,C` for project-specific layout primitives beyond the built-in set
      - `--allow <glob>` for extra token/theme files where raw values are correct
      - `--skip <check>` only with an explicit reason stated in the report

      The script is a heuristic — it flags for review, it does not prove correctness.
      Before reporting any finding, open the cited line and confirm it is real.
      Discard false positives rather than padding the report.
    </step>

    <step number="4" name="Structural checks the script cannot make">
      Static regex cannot see architecture. Check these by reading the code:

      RULE 1 — Tokens are the only styling values
      - Does a single theme/token source exist? (`@theme` block, `tokens.css`, a tokens module)
      - Are token names semantic (`primary`, `surface`, `destructive`) or primitive (`blue-500`)?
        Primitive-only themes satisfy the linter and still fail the rule.

      RULE 2 — Components are defined once, in the library
      - Grep for components defined outside the library — an exported function
        returning JSX inside `app/`, `pages/`, `features/`, `screens/`.
      - Grep app code for styled raw elements (a duplicate component in disguise):
        `<button className=`, `<input className=`, `<select className=`, `<a className=` with
        appearance classes. Exempt the library directory itself — that is where raw
        elements belong.
      - Do library components have stories? (the script's `missing-story` check)

      RULE 3 — Appearance lives inside the component
      - Do library components expose a variants API (CVA, or the framework equivalent),
        or do they branch on ad-hoc booleans?
      - Are interactive states (hover/focus/disabled/loading/invalid) defined inside
        the component, or re-implemented at call sites?

      RULE 4 — Parents own layout, components own appearance
      - Do library components ship with outer margins baked in? (`m-*` on a root element
        is a violation — spacing is the parent's decision.)

      RULE 5 — Screens compose; one-offs are quarantined
      - Are one-offs named `*.snowflake.*` and greppable, or are they anonymous?
      - Any component duplicated 3+ times that should be promoted (rule of three)?

      GUARDRAIL INFRASTRUCTURE
      - ESLint/Stylelint rules from `assets/` present in the project's config?
      - Is the audit script wired into CI or a pre-commit hook?
      - Storybook present, with a Foundations / Components / Recipes / Snowflakes hierarchy?
    </step>

    <step number="5" name="Report">
      Report against the rules, not against the checks. Every finding cites `file:line`.

      ```
      Design System Guardrails — {scope}
      Verdict: PASS | PASS WITH WARNINGS | FAIL

      Rule 1 · Tokens are the only styling values      ✅ | ⚠️ N | ❌ N
      Rule 2 · Components defined once, in the library ✅ | ⚠️ N | ❌ N
      Rule 3 · Appearance lives inside the component   ✅ | ⚠️ N | ❌ N
      Rule 4 · Parents own layout                      ✅ | ⚠️ N | ❌ N
      Rule 5 · Screens compose; one-offs quarantined   ✅ | ⚠️ N | ❌ N
      Guardrails · lint + CI + Storybook               ✅ | ⚠️ | ❌

      ❌ Blocking
        path/to/file.tsx:42   bg-[#1a56db]
            Rule 1 — add a `--color-brand` token to the theme, then use `bg-brand`.

      ⚠️  Advisory
        …

      Top 3 fixes by leverage:
        1. …  (unblocks N findings)
      ```

      Rank fixes by how many findings each one removes — the migration order in
      SKILL.md is: extract the most-repeated hardcoded values into tokens, then
      consolidate the most-duplicated component, then sweep screens, then lock in lint.

      VERDICT rules:
      - FAIL   — any blocking finding (errors always; warnings too under `--strict` or `--changed`)
      - PASS WITH WARNINGS — advisory findings only
      - PASS   — none

      100% is an explicit non-goal. If the repo has heavy pre-existing drift, say so
      and recommend the phased rollout rather than a big-bang cleanup.
    </step>

    <step number="6" name="Fix (only with --fix)">
      Never fix in `validate` mode. With `--fix`, work in dependency order so later
      fixes build on earlier ones:

      1. **Tokens first.** Add the missing tokens to the theme. Group near-identical
         values (`#1a56db` and `#1a57dc` are one token, not two) and name them by role.
      2. **Replace values with tokens** at every call site.
      3. **Promote call-site overrides to variants.** For each `appearance-override`,
         add a named variant in the library component + a story for it, then switch
         the call site to the variant.
      4. **Extract duplicated components** into the library with variants + stories.
      5. **Quarantine genuine one-offs** — rename to `*.snowflake.*`, compose from
         tokens and library parts.
      6. **Add missing stories** for library components, covering every variant and
         state (default, hover, focus, disabled, loading, error, empty).

      Rules while fixing:
      - Never change rendered appearance while replacing a raw value with a token.
        If a token does not match the existing value exactly, ask before rounding.
      - Re-run step 3 after each group and show the delta.
      - Do not touch files outside the resolved scope.
      - If a fix requires a product decision (two similar colors that may be
        intentionally different), list it as "needs a decision" instead of guessing.
    </step>

    <step number="7" name="Setup (only with --setup)">
      Scaffold in this order — tokens before components, components before screens
      (SKILL.md, "Setting up a new app"). Read the matching reference before each:

      1. Theme/token file → `references/design-tokens.md`
         (Tailwind v4: an `@theme` block with `--color-*: initial` to wipe defaults, so
         only semantic tokens compile into utilities)
      2. Component library + Storybook hierarchy → `references/storybook-structure.md`
      3. Component pattern with a variants API and layout primitives → `references/component-patterns.md`
      4. Guardrails → `references/enforcement.md`
         - copy `assets/eslint.guardrails.example.mjs` and `assets/stylelint.guardrails.example.cjs`
         - add `bun ${CLAUDE_PLUGIN_ROOT}/skills/frontend/design-system-guardrails/scripts/audit-ui.ts . --changed`
           to CI and/or a pre-commit hook

      Confirm the target paths with the user before writing — do not assume the
      project's layout. Roll out as warnings repo-wide + errors on changed files.
    </step>

  </workflow>

  <constraints>
    - `validate` mode is READ-ONLY. Never edit a file without `--fix` or `--setup`.
    - Every reported finding must be confirmed by reading the cited line first.
    - Report findings against the rule they break, not the regex that caught them.
    - Never report a verdict you did not measure — if a check could not run
      (bun missing, no Storybook, unreadable config), say so explicitly rather
      than marking it ✅.
  </constraints>
</instructions>
