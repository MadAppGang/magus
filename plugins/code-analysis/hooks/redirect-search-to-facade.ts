#!/usr/bin/env bun
/**
 * redirect-search-to-facade.ts — PreToolUse hook. Deny a DISCOVERY-shaped `Bash` search
 * once, and tell the model to use `code_search` instead.
 *
 * ---------------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Measured over 72 benchmark scenarios and three different search engines: the agent
 * called this plugin's MCP tools ZERO times. 201 tool calls, every one of them `Bash` or
 * `Read`. The server was loaded and working the whole time — remove `Bash` from the
 * toolset and the same scenarios use the facade and score MacroF1 0.385. Nothing about
 * the tools' descriptions moved that number.
 *
 * So this is the enforcement lever, and it is deliberately the narrowest possible one.
 *
 * ---------------------------------------------------------------------------------
 * WHY IT MUST NOT FIRE ON EVERY SEARCH — THE FAILURE THIS FILE IS DESIGNED AROUND
 *
 * An independent five-model review split on whether interception is even the right idea,
 * and BOTH reviewers who voted named the same failure mode: a blanket grep-deny enforces
 * WORSE behaviour, because `rg` genuinely beats an index for an exact literal you already
 * know how to spell. The dissenting reviewer went further — on a small corpus, preferring
 * ripgrep may simply be CORRECT, and a hook that fights it makes the product worse while
 * appearing to work.
 *
 * The discrimination below is therefore the whole design, not a detail:
 *
 *   REDIRECTED   a bare identifier — `rg withFileLock`, `grep -rn saveSettings src/`.
 *                "Where is this thing?" is exactly what an index answers better: it
 *                returns the DEFINITION with its enclosing symbol, where a text match
 *                returns every mention including imports and comments.
 *
 *   ALLOWED      everything else, and the list is long on purpose:
 *                - regex metacharacters -> the agent wants pattern semantics we do not offer
 *                - a quoted phrase with spaces -> literal text, not a symbol
 *                - `-c`/`--count`, `-l`/`--files-with-matches` -> counting and listing,
 *                  which the facade does not do at all
 *                - `find -name '*.ts'` and friends -> a filename question, not a code one
 *                - a pipeline -> the search feeds something else; denying strands it
 *                - anything not search-shaped -> builds, tests, git, everything
 *
 * ---------------------------------------------------------------------------------
 * THREE MORE GUARDS, EACH AGAINST A SPECIFIC WAY THIS GOES WRONG
 *
 *   BUDGET       at most `adoption.interceptBudget` denials per session (default 1).
 *                Without it: deny -> the model retries a variant -> deny again, forever.
 *                One nudge is a redirect; five is a fight the user did not ask for.
 *
 *   ENGINE       silent when no engine is configured. Redirecting to a facade that
 *                cannot answer is worse than not redirecting at all — it strands the
 *                agent with neither route.
 *
 *   OFF          `adoption.interceptBash` defaults to FALSE. This changes behaviour the
 *                user did not ask for, so it is opt-in, and the benchmark's control arm
 *                is the world where this file does nothing.
 *
 * ---------------------------------------------------------------------------------
 * CONTRACT. Reads the PreToolUse payload as JSON on stdin. Exit 0 always — the decision
 * travels in the JSON, because `permissionDecisionReason` is the field the MODEL reads,
 * whereas an exit-2 block surfaces stderr to the USER. We want to steer the model, so we
 * never exit 2. An unreadable payload, a missing settings file or any thrown error means
 * ALLOW: a hook that fails closed would break every Bash call in the session.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";

/** Search binaries worth intercepting. `ls` is deliberately absent: `ls -R` is a
 *  directory question, and the facade has no answer shaped like a directory listing. */
const SEARCH_BINARIES = /^\s*(?:rg|grep|egrep|fgrep|ag|ack|ripgrep)\b/u;
const FIND_BINARY = /^\s*find\b/u;

/** Regex metacharacters. Their presence means the agent wants pattern semantics. */
const REGEX_METACHARS = /[.*+?^$()[\]{}|\\]/u;

/** A plain code identifier — the one shape an index answers better than a text match. */
const BARE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

/**
 * Flags of `grep`, `rg` and `find` that take their value as the NEXT token. The token
 * after one of these is the flag's argument, never the search pattern.
 *
 * Only the separated form needs listing: `--type=py` carries its value inline and is
 * already skipped as a `-`-prefixed token. Anything not listed here falls through to the
 * existing behaviour, which allows rather than denies — the safe direction, and the one
 * the rest of `discoveryTarget` takes.
 */
const VALUE_TAKING_FLAGS = new Set([
  "-e",
  "-f",
  "-m",
  "-A",
  "-B",
  "-C",
  "-g",
  "-t",
  "-T",
  "-d",
  "--regexp",
  "--file",
  "--max-count",
  "--max-depth",
  "--after-context",
  "--before-context",
  "--context",
  "--glob",
  "--iglob",
  "--type",
  "--type-not",
  "--include",
  "--exclude",
  "--exclude-dir",
  "--name",
  "--path",
]);

/**
 * Flags meaning the agent wants something the facade structurally does not return:
 * a COUNT (`-c`), a FILE LIST (`-l`/`-L`), or just the matched substring (`-o`).
 *
 * MATCHED INSIDE COMBINED SHORT-FLAG GROUPS, which a word boundary cannot do. Real agent
 * commands are `grep -rli "symlink"` and `grep -rIl "checksum"` — the `l` is buried in a
 * group, and an earlier `-(?:c|l|L|o)\b` missed every one of them. It would then have
 * redirected a "which FILES contain this" question to a tool that answers "where is this
 * DEFINED", which is the enforce-worse-behaviour failure this hook exists to avoid.
 *
 * Long forms are listed separately because they carry no group.
 */
const NON_LOCATION_FLAGS =
  /(?:^|\s)-[a-zA-Z]*[clLo][a-zA-Z]*(?:\s|$)|--count\b|--files-with-matches\b|--files-without-match\b|--only-matching\b|--files\b/u;

/**
 * The same guard with `-l`/`-L` removed — a count (`-c`) and a matched substring (`-o`)
 * are still excluded.
 *
 * WHY THIS VARIANT EXISTS. Measured against a real bench run, the narrow guard above
 * fired 11 times and denied 0: every command the agent issued was a `grep -rln` or
 * carried an alternation, so the hook tested nothing at all. `-l` was the single largest
 * share of those.
 *
 * WHY `-l` IS ARGUABLY LOCATION AND `-c`/`-o` ARE NOT. `grep -rln withFileLock` asks
 * WHICH FILES contain a symbol. `code_search` returns ranked file:line hits covering
 * references as well as declarations, so it answers that question with strictly more
 * information. A count and a matched substring are different questions the facade cannot
 * answer at all.
 *
 * THIS IS NOT SETTLED, WHICH IS WHY IT IS A FLAG AND NOT AN EDIT. Widening after seeing
 * the narrow variant produce nothing is exactly the shape of tuning an intervention to
 * fit its own null result. So both run as separate rows over identical scenarios and the
 * comparison decides, rather than this comment.
 */
const NON_LOCATION_FLAGS_WIDE =
  /(?:^|\s)-[a-zA-Z]*[co][a-zA-Z]*(?:\s|$)|--count\b|--only-matching\b/u;

/** Calibration of what counts as a discovery search. See NON_LOCATION_FLAGS_WIDE. */
export interface DiscoveryOptions {
  /** Treat `-l`/`-L` as a location query rather than a file-list request. Default false. */
  listIsLocation?: boolean;
}

interface HookInput {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: { command?: string };
}

interface Adoption {
  interceptBash?: unknown;
  interceptBudget?: unknown;
  /**
   * Both of these ride in SETTINGS rather than in the environment, and that is the whole
   * reason they exist in this shape.
   *
   * They used to be env vars set by a wrapper script the bench injected through
   * `settings.local.json` — a wrapper living in this checkout, by absolute path. Under
   * madbench's `sandbox: home` (macOS read confinement, 0.25.0+) a hook script outside
   * the run's own tree is allowed to START (bash is on PATH) and then denied its own
   * source: `bash(43016) deny(1) file-read-data .../redirect-search-to-facade-traced.sh`,
   * once per Bash call, nine for nine, with no error visible anywhere but the sandbox
   * log. The hook silently allowed everything.
   *
   * The plugin's own `hooks.json` registers this file via `${CLAUDE_PLUGIN_ROOT}`, which
   * is INSIDE the allow-set because the staged plugin tree is copied into the run's home.
   * So the mechanism stays here and the configuration travels in the settings file the
   * hook already opens — the same file that names the engine.
   */
  listIsLocation?: unknown;
  traceFile?: unknown;
}

function allow(): never {
  process.exit(0);
}

function deny(reason: string): never {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })}\n`,
  );
  process.exit(0);
}

/**
 * The `code-analysis` block, MERGED across the same three layers the server merges, in the
 * same order: `<home>/.claude/settings.json`, then `<project>/.claude/settings.json`, then
 * `<project>/.claude/settings.local.json`. Later wins, per key.
 *
 * It must merge rather than pick, because the hook and the server have to agree on what
 * the configuration says. An earlier version returned the FIRST layer carrying a block and
 * never read the home layer at all. That made the documented split silently inert: put
 * `engine` in `settings.json` and `adoption.interceptBash` in `settings.local.json` — the
 * layout `/code-analysis:setup` itself describes — and the hook saw a block with an
 * `adoption` and no `engine`, failed its own engine check, and allowed everything. The
 * lever read as switched on and did nothing, with no diagnostic anywhere. For a release
 * whose purpose is to MEASURE these levers, a silently inert one is the worst outcome.
 *
 * `adoption` is merged one level deeper, because that is what the server does
 * (`assignShallow(adoption, layer["adoption"])` in `mcp/core/settings.ts`); replacing it
 * wholesale would drop `engine`-layer defaults the local layer did not restate.
 *
 * Returns undefined when no layer carried a block at all, which the caller treats as
 * "not configured for this project" and allows.
 */
function readBlock(cwd: string): Record<string, unknown> | undefined {
  const layers = [
    join(homedir(), ".claude", "settings.json"),
    join(cwd, ".claude", "settings.json"),
    join(cwd, ".claude", "settings.local.json"),
  ];
  const merged: Record<string, unknown> = {};
  const adoption: Record<string, unknown> = {};
  let found = false;
  for (const path of layers) {
    if (!existsSync(path)) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (typeof parsed !== "object" || parsed === null) continue;
      const block = (parsed as Record<string, unknown>)["code-analysis"];
      if (typeof block !== "object" || block === null) continue;
      found = true;
      for (const [key, value] of Object.entries(block as Record<string, unknown>)) {
        if (key === "adoption") {
          if (typeof value === "object" && value !== null) {
            Object.assign(adoption, value as Record<string, unknown>);
          }
          continue;
        }
        merged[key] = value;
      }
    } catch {
      // Malformed settings are not this hook's problem to report; the server says so.
      continue;
    }
  }
  if (!found) return undefined;
  merged["adoption"] = adoption;
  return merged;
}

/** Denials so far this session, kept in a temp file keyed by session id. */
function spendBudget(sessionId: string, budget: number): boolean {
  const dir = join(tmpdir(), "ca-intercept");
  const path = join(dir, `${sessionId.replace(/[^A-Za-z0-9_-]/gu, "_")}.count`);
  let used = 0;
  try {
    if (existsSync(path)) used = Number.parseInt(readFileSync(path, "utf8").trim(), 10) || 0;
  } catch {
    used = 0;
  }
  if (used >= budget) return false;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, String(used + 1));
  } catch {
    // If the counter cannot be persisted we must NOT deny: an unbounded denial loop is
    // far worse than a missed redirect.
    return false;
  }
  return true;
}

/**
 * Is this a discovery search — "where is this symbol" — as opposed to a text search the
 * agent already knows the shape of?
 *
 * Returns the identifier when it is, `undefined` when the call should be left alone.
 */
export function discoveryTarget(command: string, opts: DiscoveryOptions = {}): string | undefined {
  const isGrepLike = SEARCH_BINARIES.test(command);
  // `find` is a FILENAME question end to end. It is matched only so that it is
  // explicitly not redirected, which is easier to verify than an unstated omission.
  if (FIND_BINARY.test(command)) return undefined;
  if (!isGrepLike) return undefined;

  // MEASURED, AND THIS GUARD USED TO BE THE WHOLE PROBLEM. A first version rejected any
  // command containing one of `| ; & > <`, on the reasoning that a pipeline feeds
  // something else and denying it strands the plan. Run against the 84 Bash commands a
  // real agent issued over 24 scenarios, it fired on ONE of them: 51 of the 84 were
  // rejected by this guard alone, because an agent's greps almost always carry
  // `2>/dev/null` or `| grep -v node_modules`. The hook was so cautious it tested nothing.
  //
  // Neither of those changes the QUESTION being asked. `2>/dev/null` suppresses stderr;
  // `| grep -v node_modules`, `| head`, `| sort`, `| uniq` trim the result list. The
  // intent is still "where is X", which is exactly what should be redirected.
  //
  // What genuinely must still be left alone is a pipeline that TRANSFORMS the answer into
  // a different question — `| wc -l` is a count, not a location — and anything sequencing
  // further commands, where a denial strands the rest.
  const stripped = command
    .replace(/\s*2>\s*(?:\/dev\/null|&1)\s*/gu, " ")
    .replace(/\s*\|\s*(?:head|tail|sort|uniq)(?:\s+-\S+)*\s*$/u, " ")
    .replace(/\s*\|\s*grep\s+-v\s+\S+\s*$/u, " ")
    .trim();

  // A NEWLINE SEQUENCES JUST AS `;` DOES. A multi-line Bash block is an ordinary agent
  // output shape, and denying one because its FIRST line is a grep discards every command
  // after it — `rg foo\nnpm run build\nbun test` loses the build and the tests, while the
  // denial reason mentions only the grep, so the model re-issues the search alone and the
  // rest of its plan is silently gone. `rg foo && ls` was already safe via the `&` guard;
  // the newline form must be too.
  if (/[;&<\n\r]/u.test(stripped)) return undefined;
  // A surviving pipe transforms the answer (`wc -l`, `awk`, `xargs`); a surviving `>`
  // redirects it into a file the agent means to read back.
  if (/[|>]/u.test(stripped)) return undefined;
  const flagGuard = opts.listIsLocation === true ? NON_LOCATION_FLAGS_WIDE : NON_LOCATION_FLAGS;
  if (flagGuard.test(stripped)) return undefined;

  // A QUOTED PHRASE CONTAINING SPACES IS LITERAL TEXT, NOT A SYMBOL, and it has to be
  // detected BEFORE tokenising. Splitting on whitespace shatters `'index is stale'` into
  // three tokens, none of which contains a space, so a per-token check can never see it —
  // and the first fragment (`index`) looks exactly like an identifier. That misfire sends
  // the agent to `code_search` for a phrase the index cannot match, which is the
  // "enforces worse behaviour" failure this hook is built to avoid.
  for (const quote of ["'", '"']) {
    const parts = stripped.split(quote);
    // An odd number of parts means quotes are balanced; each even-indexed part after the
    // first is a quoted run. A quoted run with whitespace in it settles the question.
    if (parts.length >= 3 && parts.some((part, i) => i % 2 === 1 && /\s/u.test(part))) {
      return undefined;
    }
  }

  // Tokenise crudely. Quoting is not fully parsed beyond the check above, and does not
  // need to be: anything ambiguous falls through to ALLOW, which is the safe direction.
  const tokens = stripped.split(/\s+/u).slice(1);
  const candidates: string[] = [];
  let skipNext = false;
  for (const token of tokens) {
    // A FLAG'S VALUE IS NOT THE SEARCH PATTERN. Skipping only `-`-prefixed tokens leaves
    // the separated argument of a value-taking flag looking exactly like a bare
    // identifier: `grep -rn --exclude-dir node_modules handleRequest .` extracted
    // `node_modules`, denied the command, and told the agent to search for "node_modules".
    // Doubly bad, because that wasted denial spends the whole `interceptBudget`, so the
    // redirect this lever exists for never fires afterwards. These flags are common in
    // agent-issued searches, so this was a routine misfire and not an edge case.
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (token.startsWith("-")) {
      // `--type=py` carries its value inline and consumes nothing.
      if (VALUE_TAKING_FLAGS.has(token)) skipNext = true;
      continue;
    }
    // A path argument, not a pattern.
    if (token.includes("/") || token.includes(".")) continue;
    candidates.push(token.replace(/^['"]|['"]$/gu, ""));
  }

  const pattern = candidates[0];
  if (pattern === undefined) return undefined;
  if (REGEX_METACHARS.test(pattern)) return undefined;
  if (!BARE_IDENTIFIER.test(pattern)) return undefined;
  // A very short token matches half the corpus; that is a text search, not a lookup.
  if (pattern.length < 4) return undefined;
  return pattern;
}

/**
 * Opt-in breadcrumb, written before ANY decision logic — but ONLY when a destination has
 * been named explicitly.
 *
 * A hook that never runs and a hook that runs and declines are indistinguishable from
 * the outside — both leave no denial in the transcript — and that ambiguity already cost
 * one paid benchmark run. This proves which happened.
 *
 * THERE IS NO DEFAULT DESTINATION, and that is a correctness requirement rather than a
 * preference. This function is called before the `interceptBash` gate, on EVERY Bash tool
 * call in every project. An earlier version fell back to a fixed path under `os.tmpdir()`
 * whenever nothing was configured, which silently handed every user of this plugin an
 * unbounded, unrotated, plaintext record of their shell commands — including any
 * credential passed inline (`curl -H 'Authorization: ...'`, `PGPASSWORD=... psql`).
 * Nobody opted into that and nobody could discover it. Naming a path is now the switch.
 */
/**
 * Where the trace goes, resolved once `main()` has read the settings block. Unset means
 * tracing is OFF, the "payload unreadable" breadcrumb included.
 */
let traceTarget: string | undefined;

function trace(line: string): void {
  // SETTINGS FIRST, env second, nothing third — and the order is the lesson.
  //
  // An early version wrote to `os.tmpdir()` alone; a harness that redirects `TMPDIR` into
  // the sandbox deletes the breadcrumb with the run, and its ABSENCE reads as "the hook
  // never fired". The next version took `CA_HOOK_TRACE` from a wrapper script — which
  // the sandbox then refused to read at all (see the `Adoption` doc comment). The
  // settings file is the only channel proven to reach the hook inside the sandbox, so it
  // wins; the env var stays as a developer override.
  const fromEnv = process.env["CA_HOOK_TRACE"];
  const target = traceTarget ?? (fromEnv !== undefined && fromEnv !== "" ? fromEnv : undefined);
  if (target === undefined) return;
  try {
    // Owner-only, both. A trace records command lines by design, so it must not be
    // readable by other local users even when it lands in a shared directory.
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, `${new Date().toISOString()} ${line}\n`, { flag: "a", mode: 0o600 });
  } catch {
    // Best effort, always. A tracing failure must never change the decision below.
  }
}

function main(): void {
  let input: HookInput;
  try {
    const raw = readFileSync(0, "utf8");
    input = JSON.parse(raw) as HookInput;
  } catch {
    trace("invoked but payload unreadable");
    allow();
  }

  // Settings BEFORE the first real breadcrumb, because the settings decide where the
  // breadcrumb goes. A block that names a `traceFile` redirects everything after this line.
  const cwd = input.cwd ?? process.cwd();
  const block = readBlock(cwd);
  const adoption = ((block?.["adoption"] ?? {}) as Adoption);
  if (typeof adoption.traceFile === "string" && adoption.traceFile !== "") {
    traceTarget = adoption.traceFile;
  }

  // The COMMAND, not the raw payload. The payload leads with `session_id` and a long
  // `transcript_path`, so a truncated dump of it never reaches the one field that
  // explains a decision — which made an earlier trace useless for exactly the question
  // it existed to answer.
  trace(`cmd ${JSON.stringify(input.tool_input?.command ?? "")}`);

  if (input.tool_name !== undefined && input.tool_name !== "Bash") allow();
  const command = input.tool_input?.command;
  if (typeof command !== "string" || command.trim() === "") allow();

  if (block === undefined) allow();

  // No engine, no redirect. Sending the agent to a facade that cannot answer leaves it
  // with neither route.
  const engine = block["engine"];
  if (typeof engine !== "string" || engine === "") allow();

  if (adoption.interceptBash !== true) allow();

  const target = discoveryTarget(command, { listIsLocation: adoption.listIsLocation === true });
  if (target === undefined) {
    trace("  -> allowed: not a discovery-shaped search");
    allow();
  }

  const budget =
    typeof adoption.interceptBudget === "number" && Number.isFinite(adoption.interceptBudget)
      ? Math.min(10, Math.max(1, Math.floor(adoption.interceptBudget)))
      : 1;
  if (!spendBudget(input.session_id ?? "no-session", budget)) {
    trace("  -> allowed: budget spent");
    allow();
  }
  trace(`  -> DENIED, redirecting to code_search "${target}"`);

  deny(
    `This project has a pre-built code index, and \`code_search\` answers "where is ${target}" ` +
      `better than a text match: it returns the DEFINITION with its enclosing symbol, where grep ` +
      `returns every mention including imports and comments.\n\n` +
      `Call \`code_search\` with query "${target}" instead.\n\n` +
      `If it does not answer, run this same command again — this redirect fires at most ` +
      `${budget} time(s) per session and will not block you twice.`,
  );
}

if (import.meta.main) main();
