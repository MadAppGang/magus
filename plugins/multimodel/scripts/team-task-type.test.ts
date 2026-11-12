import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// /multimodel:team is instruction text, so the claudish calls it makes are the call
// templates in commands/team.md. These tests read those templates: every task type must
// reach the `team` or `create_session` call it runs through as `task_type`.

const TEAM_MD = readFileSync(join(import.meta.dir, "..", "commands", "team.md"), "utf8");

/** The text of one `## Step …` or `### …` section, up to the next heading of any level ≤ 3. */
function section(heading: string): string {
  const lines = TEAM_MD.split("\n");
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start === -1) throw new Error(`no section ${heading} in team.md`);
  const end = lines.findIndex((l, i) => i > start && /^#{2,3} /.test(l));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

/** Every fenced block in `text` that opens a claudish call of the given tool. */
function calls(text: string, tool: "team" | "create_session"): string[] {
  const opener = tool === "team" ? /claudish team\(mode="(run|judge|run-and-judge)"/ : /claudish create_session\(/;
  const blocks = [...text.matchAll(/^\s*(`{3,})\n([\s\S]*?)^\s*\1\s*$/gm)].map((m) => m[2]!);
  return blocks.filter((b) => opener.test(b));
}

/** The `task_type=` argument of one call template: its value and the comment beside it. */
function taskTypeArg(call: string): { value: string; comment: string } | null {
  const m = call.match(/^\s*task_type=([^,\s)]+)[,)]?\s*(?:#\s*(.*))?$/m);
  return m ? { value: m[1]!, comment: m[2] ?? "" } : null;
}

/** The types the template sends: a literal value, or the names its comment lists for TYPE. */
function typesSent(call: string): string[] {
  const arg = taskTypeArg(call);
  if (!arg) return [];
  const literal = arg.value.match(/^"([a-z][a-z0-9-]*)"$/);
  if (literal) return [literal[1]!];
  if (/^<?TYPE>?$/.test(arg.value)) return [...arg.comment.matchAll(/\b(judge|research|plan|debug|brainstorm|implement|test|collaborate)\b/g)].map((m) => m[1]!);
  return [];
}

const TYPES = ["judge", "research", "plan", "debug", "brainstorm", "implement", "test", "collaborate"] as const;
const TASK_TYPE = /^[a-z][a-z0-9-]{0,23}$/; // claudish's own rule for the argument

// Which call each type runs through, by the section that holds the call template.
const ROUTE: Record<(typeof TYPES)[number], { section: string; tool: "team" | "create_session" }> = {
  judge: { section: "## Step 2: Start the run", tool: "team" },
  research: { section: "## Step 2: Start the run", tool: "team" },
  plan: { section: "## Step 2: Start the run", tool: "team" },
  debug: { section: "## Step 2: Start the run", tool: "team" },
  brainstorm: { section: "## Step 2: Start the run", tool: "team" },
  implement: { section: "### W3 — Start the sessions", tool: "create_session" },
  test: { section: "### W3 — Start the sessions", tool: "create_session" },
  collaborate: { section: "### C1 — Turns, one at a time", tool: "create_session" },
};

describe("task_type reaches every claudish call /team makes", () => {
  for (const type of TYPES) {
    test(`${type}: its ${ROUTE[type].tool} call passes task_type="${type}"`, () => {
      const found = calls(section(ROUTE[type].section), ROUTE[type].tool);
      expect(found.length).toBe(1);
      expect(typesSent(found[0]!)).toContain(type);
      expect(type).toMatch(TASK_TYPE);
    });
  }

  test("every team run and create_session template in team.md carries task_type", () => {
    const all = [...calls(TEAM_MD, "team"), ...calls(TEAM_MD, "create_session")];
    expect(all.length).toBe(3);
    for (const c of all) expect(taskTypeArg(c)).not.toBeNull();
  });

  test("each template sends only its own types, never another route's", () => {
    for (const type of TYPES) {
      for (const route of Object.values(ROUTE)) {
        if (route.section === ROUTE[type].section) continue;
        const [call] = calls(section(route.section), route.tool);
        expect(typesSent(call!)).not.toContain(type);
      }
    }
  });

  test("both shared rounds pass task_type", () => {
    const rounds = section("## Step R: Shared rounds");
    expect(rounds).toMatch(/Round 1:[\s\S]*?`task_type=TYPE`/);
    expect(rounds).toMatch(/Round 2:[\s\S]*?the same `task_type`/);
  });
});
