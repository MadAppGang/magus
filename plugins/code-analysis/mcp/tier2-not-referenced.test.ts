/**
 * tier2-not-referenced.test.ts — §5.3, made mechanical.
 *
 * A tier-2 passthrough is named `<engineId>_<upstreamTool>`, and NOTHING outside this
 * server may say that name: not a skill, not a command, not an agent, not a document,
 * not a bench. The rule is not stylistic. A tier-2 tool exists only when a specific
 * engine is configured, so an instruction that names one is an instruction that breaks
 * for every user running a different engine — and it breaks silently, as a tool call
 * that resolves to nothing.
 *
 * More to the point: if something a user reads needs to name a capability, that
 * capability belongs in TIER 1, behind an engine-agnostic name every engine that can
 * answer it will serve. A hit here is not a naming slip; it is the tier-2 gate having
 * been applied to something that should have gone through the port.
 *
 * Run: bun test plugins/code-analysis/mcp/tier2-not-referenced.test.ts
 *
 * Two halves, and both are needed:
 *   1. the checker is proved to FIRE, against strings written to break it. A checker
 *      that cannot fail is not evidence of anything.
 *   2. it is then run over the real tree — and the corpus size is asserted, because a
 *      path typo that scans nothing leaves this suite green and says nothing.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_IDS } from "./adapters/index";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

/**
 * `<engineId>_<name>`, where `<name>` is the shape `describePassthrough` admits:
 * /^[a-z][a-z0-9_]{2,23}$/. Built from the live engine list rather than a hand-typed
 * alternation, so a new adapter is covered the day it lands.
 *
 * The trailing lookahead excludes FILENAMES. `serena_config.yml` is a file on disk that
 * documentation has to be able to name; it is not a tool call, and no tool call is ever
 * written followed by a dot and an extension. Without the lookahead the gate fires on any
 * document that explains an engine's own config file — a false positive that pressures the
 * next reader into deleting a true sentence to get the suite green.
 */
const TIER2_PATTERN = new RegExp(
  `\\b(?:${ENGINE_IDS.join("|")})_[a-z][a-z0-9_]{2,23}\\b(?!\\.[a-z]{2,5}\\b)`,
  "gu",
);

/** Everything a human or an agent reads as instruction, plus the benches that measure
 *  those instructions. `ai-docs/` is deliberately absent: it holds the design document
 *  that had to spell this shape in order to forbid it. */
const SCAN_DIRS = [
  "plugins",
  "autotest",
  "benches",
  "benchmarks",
  "docs",
  "userdocs",
  "skills",
] as const;

const EXTENSIONS = [".md", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".sh", ".yaml", ".yml"];

/** Generated output and vendored trees. Nothing here is authored instruction. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".mnemex",
  ".claudemem",
  "results",
  // madbench `--report-dir` output. A report records what an AGENT said and called,
  // transcript included; grading it as authored instruction flagged 259 mentions in one
  // 40 MB file, every one of them a tool the agent had been handed by the engine.
  ".reports",
  "dist",
  "build",
  "coverage",
]);

interface Hit {
  file: string;
  line: number;
  name: string;
}

// ---------------------------------------------------------------------------
// The checker — pure, so it can be proved to fire
// ---------------------------------------------------------------------------

export function findTier2Names(file: string, text: string): Hit[] {
  const hits: Hit[] = [];
  text.split("\n").forEach((raw, index) => {
    for (const match of raw.matchAll(TIER2_PATTERN)) {
      hits.push({ file, line: index + 1, name: match[0] });
    }
  });
  return hits;
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

/**
 * THE SERVER'S OWN IMPLEMENTATION. Excluded because the rule is "nothing OUTSIDE this
 * server", and this is the inside.
 *
 * It became load-bearing with codegraph. Every other engine's upstream tools have bare
 * names — serena's `find_symbol`, mnemex's `search_code` — and the facade constructs the
 * tier-2 name by prefixing the engine id, so the forbidden shape never appears in
 * adapter source. codegraph's upstream tools are ALREADY prefixed with its own name:
 * `codegraph_search`, `codegraph_callers`, `codegraph_impact`. Its adapter cannot call
 * them without writing the shape, and the alternative — obfuscating the tool names it
 * sends over the wire — would make the one file that must match the engine exactly the
 * one file that is not allowed to say what the engine calls things.
 *
 * The gate keeps its whole reach over INSTRUCTION: `plugins/code-analysis/skills`,
 * `commands` and `agents` are all still scanned, as are docs, benches and every other
 * plugin. Only `mcp/` — the server — is inside.
 */
const SERVER_SOURCE = join("plugins", "code-analysis", "mcp") + sep;

/** A test must be able to spell the forbidden shape in order to forbid it. Fixtures
 *  stand in for third-party payloads and are not instruction either. */
function isScannable(path: string): boolean {
  if (path.endsWith(".test.ts")) return false;
  if (path.includes(`${sep}__fixtures__${sep}`)) return false;
  if (relative(REPO_ROOT, path).startsWith(SERVER_SOURCE)) return false;
  return EXTENSIONS.some((extension) => path.endsWith(extension));
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // A root that does not exist is caught by the corpus-size assertion below.
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue; // A broken symlink is not instruction.
    }
    if (isDir) {
      walk(full, out);
      continue;
    }
    if (isScannable(full)) out.push(full);
  }
}

function corpus(root: string): string[] {
  const files: string[] = [];
  walk(join(REPO_ROOT, root), files);
  return files.sort();
}

function scan(files: readonly string[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    hits.push(...findTier2Names(relative(REPO_ROOT, file), text));
  }
  return hits;
}

function format(hits: readonly Hit[]): string {
  return hits.map((hit) => `${hit.file}:${hit.line} names the tier-2 tool ${hit.name}`).join("\n");
}

// ---------------------------------------------------------------------------
// Half 1 — the checker fires
// ---------------------------------------------------------------------------

describe("the tier-2 check fires", () => {
  test("catches a passthrough name for every engine this plugin ships", () => {
    expect(ENGINE_IDS.length).toBe(4);
    for (const id of ENGINE_IDS) {
      const hits = findTier2Names("SKILL.md", `Call ${id}_index_status before searching.`);
      expect(hits.map((hit) => hit.name)).toEqual([`${id}_index_status`]);
    }
  });

  test("catches one inside prose, in backticks, and in a tool-call payload", () => {
    expect(findTier2Names("a.md", "use `mnemex_map` first").length).toBe(1);
    expect(findTier2Names("b.json", '{"tool":"mnemex_index_codebase"}').length).toBe(1);
    expect(findTier2Names("c.md", "serena_find_symbol, then mnemex_dead_code").length).toBe(2);
  });

  test("does NOT fire on the names that legitimately look similar", () => {
    // Tier 0 and tier 1: engine-agnostic by construction, which is the whole point.
    expect(findTier2Names("a.md", "code_search, find_dependents, call_tree")).toEqual([]);
    // The skills, which are hyphenated.
    expect(findTier2Names("b.md", "mnemex-search and mnemex-orchestration")).toEqual([]);
    // An environment variable, which is upper case.
    expect(findTier2Names("c.md", "Set CODEGRAPH_MCP_TOOLS to the full list.")).toEqual([]);
    // The engine id on its own, and a sentence that merely mentions one.
    expect(findTier2Names("d.md", "Set engine to mnemex, or to serena.")).toEqual([]);
    // Too short to be an admissible passthrough name (`{2,23}` after the first char).
    expect(findTier2Names("e.md", "mnemex_ab")).toEqual([]);
    // A FILENAME. Both engines keep config under a name of this shape, and documentation
    // that explains where an engine reads its settings has to be able to say so.
    expect(findTier2Names("f.md", "serena writes `serena_config.yml` on first run")).toEqual([]);
    expect(findTier2Names("g.ts", 'join(home, "serena_config.yaml")')).toEqual([]);
  });

  test("the filename escape is narrow: a bare name still fires, a sentence end still fires", () => {
    // The lookahead must not become a way to smuggle a real tool name past the gate.
    expect(findTier2Names("a.md", "read serena_config to see the modes").length).toBe(1);
    // A passthrough at the end of a sentence is followed by a dot and a SPACE, not by an
    // extension — the single case most likely to be broken by a sloppier lookahead.
    expect(findTier2Names("b.md", "Call serena_find_symbol. Then read the file.").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Half 2 — the tree is clean, and the corpus is real
// ---------------------------------------------------------------------------

describe("nothing outside this server names a tier-2 tool", () => {
  /**
   * The server exclusion is a hole in the gate, so its edges are asserted rather than
   * trusted. It must swallow the adapter that has to name `codegraph_search`, and it
   * must NOT swallow the skills, commands and agents sitting in the same plugin — those
   * are instruction, and instruction is the whole point of the rule.
   */
  test("the server exclusion covers mcp/ and nothing else in the plugin", () => {
    const inside = corpus("plugins").filter((file) =>
      relative(REPO_ROOT, file).startsWith(join("plugins", "code-analysis", "mcp") + sep),
    );
    expect(inside).toEqual([]);

    const stillScanned = corpus("plugins").filter((file) =>
      relative(REPO_ROOT, file).startsWith(join("plugins", "code-analysis") + sep),
    );
    // The plugin's own instruction surface is still in the corpus. Asserted as a count
    // so that deleting the last skill does not quietly turn this into a vacuous pass.
    expect(stillScanned.length).toBeGreaterThan(0);
    for (const file of stillScanned) {
      expect(relative(REPO_ROOT, file)).not.toContain(join("code-analysis", "mcp") + sep);
    }
  });

  test("the corpus is real: every scanned root contributed files", () => {
    const counted = SCAN_DIRS.map((root) => ({ root, files: corpus(root).length }));
    // Named per root, so a root that vanished says WHICH one rather than just failing.
    expect(counted.filter((entry) => entry.files === 0)).toEqual([]);
    const total = counted.reduce((sum, entry) => sum + entry.files, 0);
    // A floor, not a target. It exists so a path typo that scans three files cannot
    // leave this suite green.
    expect(total).toBeGreaterThan(500);
  });

  test("no skill, command, agent, doc or bench names a tier-2 passthrough", () => {
    const hits = SCAN_DIRS.flatMap((root) => scan(corpus(root)));
    // A hit means the tier-2 gate was applied wrongly: something a reader needs to name
    // must be a TIER-1 capability behind an engine-agnostic name, not a passthrough.
    expect(format(hits)).toBe("");
  });

  test("the repo's own top-level documents are clean too", () => {
    const files = readdirSync(REPO_ROOT)
      .filter((entry) => entry.endsWith(".md"))
      .map((entry) => join(REPO_ROOT, entry));
    expect(files.length).toBeGreaterThan(3);
    expect(format(scan(files))).toBe("");
  });
});
