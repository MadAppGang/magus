/**
 * Wiring tests for the claudish session monitor (design §8.5, §4.1, §5.6): the monitor
 * declaration, the plugin manifest, the MCP launch, and the docs a user reads.
 *
 * Every path is resolved from this file's directory (plugins/claudish/scripts/), never hardcoded.
 * Written blind, from the specification and contracts only. REQ ids are in TEST-PLAN.md.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { MIN_CLAUDISH_VERSION, PREFIX } from "./session-monitor.ts";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
const MONITORS_JSON = join(REPO_ROOT, "plugins", "claudish", "monitors", "monitors.json");
const MANIFEST = join(REPO_ROOT, "plugins", "claudish", ".claude-plugin", "plugin.json");
const README = join(REPO_ROOT, "plugins", "claudish", "README.md");
const SKILL = join(REPO_ROOT, "plugins", "claudish", "skills", "claudish-usage", "SKILL.md");
const TEAM_CMD = join(REPO_ROOT, "plugins", "multimodel", "commands", "team.md");

interface MonitorEntry {
  name?: unknown;
  command?: unknown;
  description?: unknown;
  when?: unknown;
}

function readMonitors(): MonitorEntry[] {
  const parsed = JSON.parse(readFileSync(MONITORS_JSON, "utf8")) as unknown;
  expect(Array.isArray(parsed)).toBe(true);
  return parsed as MonitorEntry[];
}

function only(): { name: string; command: string; description: string; when: string } {
  const entries = readMonitors();
  expect(entries).toHaveLength(1);
  const e = entries[0]!;
  expect(typeof e.command).toBe("string");
  expect(typeof e.description).toBe("string");
  return { name: String(e.name), command: String(e.command), description: String(e.description), when: String(e.when) };
}

/** The text of the first heading containing `title`, up to the next heading of the same or higher level. */
function section(markdown: string, title: string): string | null {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.includes(title));
  if (start < 0) return null;
  const level = (lines[start]!.match(/^#+/) ?? [""])[0].length;
  const end = lines.findIndex((l, i) => i > start && /^#{1,6}\s/.test(l) && (l.match(/^#+/) ?? [""])[0].length <= level);
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

// ---------------------------------------------------------------------------------------------
// monitors/monitors.json (REQ-WR1..WR5)
// ---------------------------------------------------------------------------------------------

describe("monitors/monitors.json (REQ-WR1..WR5, R3.1, §4.1)", () => {
  test("REQ-WR1: it exists and declares exactly one monitor, claudish-sessions, started always", () => {
    expect(existsSync(MONITORS_JSON)).toBe(true);

    const m = only();

    expect(m.name).toBe("claudish-sessions");
    expect(m.when).toBe("always");
  });

  test("REQ-WR2: the command runs the plugin's script under bun with --env-file=/dev/null", () => {
    const { command } = only();

    expect(command).toStartWith("bun ");
    expect(command).toContain("--env-file=/dev/null");
    expect(command).toContain("${CLAUDE_PLUGIN_ROOT}/scripts/session-monitor.ts");
  });

  test("REQ-WR2: the script the command names exists in the plugin", () => {
    const { command } = only();
    const match = /\$\{CLAUDE_PLUGIN_ROOT\}(\/[^"'\s]+)/.exec(command);

    expect(match).not.toBeNull();
    expect(existsSync(join(PLUGIN_ROOT, match![1]!))).toBe(true);
  });

  test("REQ-WR3: the command names no session variable; CLAUDE_PLUGIN_ROOT is the only variable it references", () => {
    const { command } = only();
    const vars = [...command.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);

    expect(vars.length).toBeGreaterThan(0);
    expect(new Set(vars)).toEqual(new Set(["CLAUDE_PLUGIN_ROOT"]));
    expect(command).not.toContain("CLAUDE_CODE_SESSION_ID");
    expect(command).not.toContain("CLAUDE_PID");
  });

  test("REQ-WR4: the command carries no hardcoded machine path (R3.11)", () => {
    const { command } = only();

    expect(command).not.toMatch(/\/Users\/|\/home\/|~\//);
  });

  test("REQ-WR5: the description names create_session and team and does not contain the line prefix", () => {
    const { description } = only();

    expect(description.trim().length).toBeGreaterThan(0);
    expect(description).toContain("create_session");
    expect(description).toContain("team");
    expect(description).not.toContain(PREFIX);
  });
});

// ---------------------------------------------------------------------------------------------
// Manifest and MCP launch (REQ-WR6..WR8)
// ---------------------------------------------------------------------------------------------

describe("plugin manifest and MCP launch (REQ-WR6..WR8)", () => {
  test("REQ-WR6: plugin.json declares no monitors field (monitors/monitors.json is the default location)", () => {
    expect(existsSync(MANIFEST)).toBe(true);
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Record<string, unknown>;

    expect(Object.keys(manifest)).not.toContain("monitors");
    const rootManifest = join(PLUGIN_ROOT, "plugin.json");
    if (existsSync(rootManifest)) {
      expect(Object.keys(JSON.parse(readFileSync(rootManifest, "utf8")) as object)).not.toContain("monitors");
    }
  });

  test("REQ-WR7: no plugin's .mcp.json sets CLAUDE_CODE_SESSION_ID in a server env (Claude Code sets it itself)", () => {
    const pluginsDir = join(REPO_ROOT, "plugins");
    const offenders: string[] = [];
    let scanned = 0;
    for (const name of readdirSync(pluginsDir)) {
      const file = join(pluginsDir, name, ".mcp.json");
      if (!existsSync(file)) continue;
      scanned++;
      const doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const servers = (doc.mcpServers ?? doc) as Record<string, { env?: Record<string, unknown> }>;
      for (const [server, cfg] of Object.entries(servers)) {
        if (cfg && typeof cfg === "object" && cfg.env && Object.hasOwn(cfg.env, "CLAUDE_CODE_SESSION_ID")) {
          offenders.push(`${name}:${server}`);
        }
      }
    }

    expect(scanned).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  test("REQ-WR8: the claudish plugin launches claudish --mcp directly, with no wrapper process between it and Claude Code", () => {
    const file = join(PLUGIN_ROOT, ".mcp.json");
    expect(existsSync(file)).toBe(true);
    const doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const servers = Object.values((doc.mcpServers ?? doc) as Record<string, { command?: string; args?: string[] }>);

    const direct = servers.filter((s) => s && s.command === "claudish" && Array.isArray(s.args) && s.args.includes("--mcp"));

    expect(direct.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Docs where a user looks (REQ-WR9..WR11, R3.12, amendment "documented waits")
// ---------------------------------------------------------------------------------------------

describe("docs (REQ-WR9..WR11, R3.12)", () => {
  test("REQ-WR9: the plugin README documents the monitor: prefix, needs-input, waited, team-status and the minimum claudish version", () => {
    const readme = readFileSync(README, "utf8");

    expect(readme).toContain(PREFIX);
    expect(readme).toContain("needs-input");
    expect(readme).toContain("waited");
    expect(readme).toContain("team-status");
    expect(readme).toContain(MIN_CLAUDISH_VERSION);
  });

  test("REQ-WR10: the claudish-usage skill shows monitor lines and a run-end wait on meta.json; status.json is only the no-monitor_record fallback", () => {
    const skill = readFileSync(SKILL, "utf8");
    const wait = section(skill, "Waiting for a run to end");

    expect(skill).toContain(PREFIX);
    expect(wait).not.toBeNull();
    expect(wait!).toContain("meta.json");
    expect(wait!).toContain("monitor_record");

    // The primary wait (the first command block) reads the end record, never status.json.
    const blocks = [...wait!.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]!);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]!).toContain("meta.json");
    expect(blocks[0]!).toContain("MONITOR_RECORD");
    expect(blocks[0]!).not.toContain("status.json");

    // A wait on status.json exists only for a run result without monitor_record (claudish < 10.4.0).
    for (const block of blocks.filter((b) => b.includes("status.json"))) {
      expect(block).toContain("no monitor_record");
    }
    // Every paragraph naming status.json either forbids it while monitor_record is present
    // or scopes it to a result without monitor_record.
    for (const para of wait!.split(/\n\s*\n/).filter((p) => p.includes("status.json") && !p.includes("```"))) {
      expect(/never wait on|no `monitor_record`/i.test(para)).toBe(true);
    }
  });

  test("REQ-WR11: the multimodel team command correlates a run with its monitor record", () => {
    expect(readFileSync(TEAM_CMD, "utf8")).toContain("monitor_record");
  });
});
