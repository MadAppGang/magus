/**
 * imports.test.ts — the lint that makes the hexagon real.
 *
 * core/ imports nothing from ../adapters or ../transport, takes no node: module
 * outside a type-only position, has no runtime dependency at all, never reads a named
 * key out of `evidence`, and never names the opaque per-engine health map outside
 * render.ts. Nothing enforces any of that except this file: the typecheck gate cannot
 * see an import graph, and Bun strips types at runtime.
 *
 * Two halves, and both are needed:
 *   1. the rules are proved to FIRE, against in-memory sources written to break them.
 *      A checker that cannot fail is not evidence of anything.
 *   2. the rules are then run over the real modules — and the file list itself is
 *      asserted, because a glob typo that scans nothing leaves a suite green.
 *
 * The scan covers what SHIPS: `*.test.ts` and `__fixtures__/**` are excluded. A test
 * that imports node:fs to read the source tree is correct, and a fake MCP server's
 * stdout IS its protocol channel. The rules themselves are not weakened for anything.
 *
 * Run: bun test plugins/code-analysis/mcp/core/imports.test.ts
 */

import { describe, expect, test } from "bun:test";

// Declared locally rather than imported: a `node:fs` import here would violate the
// very rule this file enforces, and the rule reads better for applying to itself.
declare const Bun: {
  Glob: new (pattern: string) => {
    scanSync(options: { cwd: string; absolute?: boolean }): Iterable<string>;
  };
  file(path: string): { text(): Promise<string> };
};

// `import.meta.dirname`, not Bun's `import.meta.dir`: the same value, but this one is
// typed by @types/node and so survives the typecheck gate.
const CORE_DIR = import.meta.dirname;
const MCP_DIR = `${import.meta.dirname}/..`;

/** The one module allowed to name the opaque per-engine health map, plus the file that
 *  declares it. Everywhere else it is the same leak as reading `evidence`. */
const DETAIL_ALLOWED = new Set(["render.ts", "ports.ts"]);

/** Files allowed to write to stdout at all: stdout IS the JSON-RPC channel. */
const STDOUT_ALLOWED = new Set(["transport/jsonrpc.ts", "server.ts"]);

interface Violation {
  file: string;
  line: number;
  rule: string;
  detail: string;
}

interface ImportRef {
  spec: string;
  typeOnly: boolean;
  line: number;
}

// ---------------------------------------------------------------------------
// The checkers — pure, so they can be proved to fire
// ---------------------------------------------------------------------------

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

export function importSpecifiers(text: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const push = (spec: string, typeOnly: boolean, index: number): void => {
    refs.push({ spec, typeOnly, line: lineOf(text, index) });
  };

  // `import ... from "x"` / `export ... from "x"`, including multi-line clauses. The
  // gap is restricted to the characters an import clause can actually contain —
  // identifiers, braces, commas, `*`, whitespace. Anything looser and the scan runs
  // from the word "export" in a header comment to whatever the next quoted `from`
  // happens to be, several paragraphs away, and reports it as a dependency.
  const fromRe = /\b(import|export)\s+(type\s+)?[A-Za-z0-9_$*{},\s]*?\bfrom\s*["']([^"']+)["']/gu;
  for (let m = fromRe.exec(text); m !== null; m = fromRe.exec(text)) {
    push(m[3] ?? "", m[2] !== undefined, m.index);
  }
  // Side-effect import, dynamic import, and require: all runtime, never type-only.
  const otherRe =
    /\bimport\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']/gu;
  for (let m = otherRe.exec(text); m !== null; m = otherRe.exec(text)) {
    push(m[1] ?? m[2] ?? m[3] ?? "", false, m.index);
  }
  return refs;
}

/** The import graph: the hexagon's one structural rule, plus zero runtime deps. */
export function checkImports(file: string, text: string): Violation[] {
  const found: Violation[] = [];

  for (const { spec, typeOnly, line } of importSpecifiers(text)) {
    if (/(?:^|\/)(?:adapters|transport)(?:\/|$)/u.test(spec)) {
      // A type-only import is no escape hatch. transport/ would give core/ a path to
      // node:child_process, and adapters/ would let an engine's vocabulary back in.
      found.push({ file, line, rule: "no-adapters-or-transport", detail: spec });
      continue;
    }
    if (spec.startsWith("node:")) {
      if (!typeOnly) found.push({ file, line, rule: "node-types-only", detail: spec });
      continue;
    }
    if (spec.startsWith(".")) continue;

    // Anything else is a bare specifier: an npm package, or a runtime Bun module. The
    // plugin ships with no node_modules and no install step, so a runtime dependency
    // here fails at session start with "MCP server unavailable" and no cause.
    found.push({ file, line, rule: "no-runtime-dependencies", detail: spec });
  }
  return found;
}

/** Content rules: the two things the port must not leak back into core/. */
export function checkContent(file: string, text: string): Violation[] {
  const found: Violation[] = [];
  const base = file.split("/").pop() ?? file;

  text.split("\n").forEach((raw, index) => {
    const line = index + 1;

    // The compiler rejects a key read off `unknown`. What it cannot see is a cast, so
    // the literal check adds the two shapes a cast would produce.
    if (raw.includes("evidence.") || raw.includes("evidence[")) {
      found.push({ file, line, rule: "no-evidence-key-read", detail: raw.trim() });
    }
    if (raw.includes("evidence")) {
      for (const cast of [
        "as any",
        "as Record",
        "as {",
        "as unknown as",
        "@ts-expect-error",
        "@ts-ignore",
      ]) {
        if (raw.includes(cast)) found.push({ file, line, rule: "no-evidence-cast", detail: cast });
      }
    }
    // Named at all, not just read: the moment routing or the registry can spell a key
    // in an engine's own health vocabulary, the dispatch table has learned an engine.
    if (raw.includes("detail") && !DETAIL_ALLOWED.has(base)) {
      found.push({ file, line, rule: "detail-render-only", detail: raw.trim() });
    }
  });
  return found;
}

/**
 * stdout purity, over everything under mcp/ that ships.
 *
 * This server speaks JSON-RPC over stdout, so one stray `console.log` in shipped code
 * corrupts the framing — and the failure then surfaces as a protocol error, nowhere
 * near the logging mistake that caused it. `console.log` is never framing, so it is
 * forbidden even in the two files that are allowed to write.
 */
export function checkStdout(file: string, text: string): Violation[] {
  const found: Violation[] = [];
  text.split("\n").forEach((raw, index) => {
    const line = index + 1;
    if (raw.includes("console.log")) {
      found.push({ file, line, rule: "no-console-log", detail: raw.trim() });
    }
    if (raw.includes("process.stdout.write") && !STDOUT_ALLOWED.has(file)) {
      found.push({ file, line, rule: "no-stdout-write", detail: raw.trim() });
    }
  });
  return found;
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

/** Shipped sources only. Tests and fixtures are excluded by design — see the header. */
function shippedFiles(dir: string): string[] {
  return [...new Bun.Glob("**/*.ts").scanSync({ cwd: dir })]
    .filter((file) => !file.endsWith(".test.ts") && !file.includes("__fixtures__/"))
    .sort();
}

async function load(dir: string): Promise<{ file: string; text: string }[]> {
  const out: { file: string; text: string }[] = [];
  for (const file of shippedFiles(dir)) {
    out.push({ file, text: await Bun.file(`${dir}/${file}`).text() });
  }
  return out;
}

function format(violations: readonly Violation[]): string {
  return violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.detail}`).join("\n");
}

function rules(violations: readonly Violation[]): string[] {
  return violations.map((v) => v.rule);
}

// ---------------------------------------------------------------------------
// Half 1 — the rules fire
// ---------------------------------------------------------------------------

describe("the lint fires", () => {
  test("rejects an import from ../adapters or ../transport", () => {
    expect(rules(checkImports("route.ts", 'import { x } from "../adapters/mnemex";'))).toEqual([
      "no-adapters-or-transport",
    ]);
    expect(
      rules(checkImports("route.ts", 'import type { C } from "../transport/jsonrpc";')),
    ).toEqual(["no-adapters-or-transport"]);
    expect(rules(checkImports("route.ts", 'export { y } from "../../mcp/adapters/index";'))).toEqual(
      ["no-adapters-or-transport"],
    );
    expect(checkImports("route.ts", 'import type { A } from "./ports";')).toEqual([]);
  });

  test("rejects a runtime node: import and allows a type-only one", () => {
    expect(rules(checkImports("settings.ts", 'import { readFileSync } from "node:fs";'))).toEqual([
      "node-types-only",
    ]);
    expect(rules(checkImports("settings.ts", 'import("node:child_process");'))).toEqual([
      "node-types-only",
    ]);
    expect(rules(checkImports("settings.ts", 'require("node:fs");'))).toEqual(["node-types-only"]);
    expect(checkImports("settings.ts", 'import type { Stats } from "node:fs";')).toEqual([]);
  });

  test("rejects any bare specifier, npm or bun", () => {
    expect(rules(checkImports("route.ts", 'import { z } from "zod";'))).toEqual([
      "no-runtime-dependencies",
    ]);
    expect(rules(checkImports("route.ts", 'import { test } from "bun:test";'))).toEqual([
      "no-runtime-dependencies",
    ]);
  });

  test("rejects every shape of reading a key out of evidence", () => {
    expect(rules(checkContent("render.ts", "const r = hit.evidence.pageRank;"))).toEqual([
      "no-evidence-key-read",
    ]);
    expect(rules(checkContent("render.ts", 'const r = hit.evidence["pageRank"];'))).toEqual([
      "no-evidence-key-read",
    ]);
    expect(rules(checkContent("route.ts", "const e = hit.evidence as any;"))).toEqual([
      "no-evidence-cast",
    ]);
    expect(
      rules(checkContent("route.ts", "const e = hit.evidence as Record<string, number>;")),
    ).toEqual(["no-evidence-cast"]);
    expect(rules(checkContent("route.ts", "// @ts-ignore evidence"))).toEqual(["no-evidence-cast"]);
    // The one access render.ts needs stays legal.
    expect(checkContent("render.ts", "Object.entries(hit.evidence ?? {})")).toEqual([]);
  });

  test("rejects the opaque health map outside render.ts", () => {
    expect(rules(checkContent("registry.ts", "const m = health.detail;"))).toEqual([
      "detail-render-only",
    ]);
    expect(rules(checkContent("route.ts", "// never read engine detail here"))).toEqual([
      "detail-render-only",
    ]);
    expect(checkContent("render.ts", "const m = health.detail;")).toEqual([]);
  });

  test("rejects stdout writes outside the JSON-RPC channel", () => {
    expect(rules(checkStdout("core/route.ts", "console.log(x);"))).toEqual(["no-console-log"]);
    expect(rules(checkStdout("core/route.ts", "process.stdout.write(x);"))).toEqual([
      "no-stdout-write",
    ]);
    expect(checkStdout("transport/jsonrpc.ts", "process.stdout.write(x);")).toEqual([]);
    expect(rules(checkStdout("server.ts", "console.log(x);"))).toEqual(["no-console-log"]);
  });
});

// ---------------------------------------------------------------------------
// Half 2 — the corpus is clean, and the corpus is real
// ---------------------------------------------------------------------------

describe("core/ obeys the hexagon", () => {
  test("the scan covers the real modules and no test or fixture", () => {
    const core = shippedFiles(CORE_DIR);
    expect(core).toEqual([
      "capabilities.ts",
      "health.ts",
      "ports.ts",
      "registry.ts",
      "render.ts",
      "route.ts",
      "settings.ts",
    ]);

    const mcp = shippedFiles(MCP_DIR);
    expect(mcp).toContain("core/route.ts");
    expect(mcp.every((file) => !file.endsWith(".test.ts"))).toBe(true);
    expect(mcp.every((file) => !file.includes("__fixtures__/"))).toBe(true);
  });

  test("every shipped file under core/ has a legal import graph", async () => {
    const files = await load(CORE_DIR);
    const violations = files.flatMap(({ file, text }) => checkImports(file, text));
    expect(format(violations)).toBe("");
  });

  test("no shipped file under core/ reads a key out of evidence, or names detail", async () => {
    const files = await load(CORE_DIR);
    const violations = files.flatMap(({ file, text }) => checkContent(file, text));
    expect(format(violations)).toBe("");
  });

  test("nothing shipped under mcp/ writes to stdout except the JSON-RPC channel", async () => {
    const files = await load(MCP_DIR);
    const violations = files.flatMap(({ file, text }) => checkStdout(file, text));
    expect(format(violations)).toBe("");
  });
});
