import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The test type's blindness check in /multimodel:team is a jq program in commands/team.md.
// These tests run that exact program over a sample transcript, so they judge what the
// filter does, not how it is worded. Every `tool <name>` line it prints marks the slot
// SUSPECT. The allowed set is the one /dev:qa Phase 2 uses, read from qa.md, so the two
// checks cannot drift apart.

const ROOT = join(import.meta.dir, "..", "..", "..");
const TEAM_MD = readFileSync(join(ROOT, "plugins", "multimodel", "commands", "team.md"), "utf8");
const QA_MD = readFileSync(join(ROOT, "plugins", "dev", "commands", "qa.md"), "utf8");

/** The jq program of team.md's W5 blindness check, without the shell quoting around it. */
function blindnessFilter(): string {
  const at = TEAM_MD.indexOf("**Blindness check (test).**");
  if (at === -1) throw new Error("team.md has no **Blindness check (test).** paragraph");
  const line = TEAM_MD.slice(at).split("\n").find((l) => l.startsWith("jq -r '"));
  const m = line?.match(/^jq -r '(.*)' <transcriptPath>$/);
  if (!m) throw new Error("the blindness check has no `jq -r '…' <transcriptPath>` line");
  return m[1]!;
}

/** The tool names /dev:qa Phase 2 lets through: the IN(...) list of its second jq command. */
function qaAllowed(): string[] {
  const m = QA_MD.match(/select\(\.name \| IN\(([^)]*)\) \| not\)/);
  if (!m) throw new Error("qa.md has no `select(.name | IN(...) | not)` jq command");
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

/** The lines the filter prints for one transcript holding one call to each named tool. */
function run(names: string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "team-blindness-"));
  try {
    const file = join(dir, "transcript.jsonl");
    const input = (name: string) =>
      name === "Read" ? { file_path: "src/a.ts" }
      : name === "Grep" || name === "Glob" ? { path: ".", pattern: "x" }
      : name === "Bash" ? { command: "ls" }
      : { query: "x" };
    const records = names.map((name, i) => ({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: `t${i}`, name, input: input(name) }] },
    }));
    writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const p = Bun.spawnSync(["jq", "-r", blindnessFilter(), file]);
    if (p.exitCode !== 0) throw new Error(`jq failed: ${p.stderr.toString()}`);
    return p.stdout.toString().split("\n").filter(Boolean);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const toolLines = (out: string[]) => out.filter((l) => l.startsWith("tool ")).map((l) => l.slice(5));

describe("/team's blindness check, run over a transcript", () => {
  test("qa.md's allowed set includes ToolSearch, so the comparison below has something to compare", () => {
    expect(qaAllowed()).toContain("ToolSearch");
  });

  test("no tool in /dev:qa's allowed set becomes a SUSPECT `tool` line", () => {
    expect(toolLines(run(qaAllowed()))).toEqual([]);
  });

  test("tools that can read code outside the sandbox still become `tool` lines", () => {
    const risky = ["mcp__plugin_code-search_ca__code_search", "Agent", "Task", "Skill", "WebFetch"];
    expect(toolLines(run(risky))).toEqual(risky);
  });

  test("Read and Bash calls still become `path` and `bash` lines", () => {
    expect(run(["Read", "Bash"])).toEqual(["path src/a.ts", "bash ls"]);
  });
});
