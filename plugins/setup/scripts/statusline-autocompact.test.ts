/**
 * Black-box MTL-317 tests; no implementation imports or source inspection.
 * Run beside statusline.sh: bun --no-env-file test statusline-autocompact.test.ts
 *
 * Config comparisons seed .claude/statusline-config.json under each temporary HOME.
 * This public config location is confirmed in qa/test-results.md.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const SCRIPT = join(import.meta.dir, "statusline.sh");
const MODEL = "claude-opus-5-5";
type Settings = Record<string, unknown>;
type Options = {
  user?: Settings; project?: Settings; local?: Settings; global?: Settings;
  env?: Record<string, string>; model?: string; capacity?: number;
  input?: number; creation?: number; read?: number; output?: number;
  workspace?: boolean;
};
const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
function json(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}
function modelWindow(value: unknown, key = MODEL): Settings {
  return { modelSettings: { [key]: { autoCompactWindow: value } } };
}
function setup(o: Options = {}) {
  const home = mkdtempSync(join(tmpdir(), "statusline-acw-"));
  homes.push(home);
  const project = join(home, "project");
  json(join(home, ".claude", "settings.json"), o.user ?? {});
  json(join(home, ".claude.json"), o.global ?? {});
  json(join(project, ".claude", "settings.json"), o.project ?? {});
  json(join(project, ".claude", "settings.local.json"), o.local ?? {});
  const capacity = o.capacity ?? 1_000_000;
  const current = {
    input_tokens: o.input ?? 100_000,
    cache_creation_input_tokens: o.creation ?? 50_000,
    cache_read_input_tokens: o.read ?? 200_000,
    output_tokens: o.output ?? 5_000,
  };
  const usedInput = current.input_tokens + current.cache_creation_input_tokens + current.cache_read_input_tokens;
  const payload = {
    model: { id: o.model ?? MODEL, display_name: "Claude Opus" },
    cwd: project,
    ...(o.workspace === false ? {} : { workspace: { project_dir: project } }),
    session_id: "acw-test",
    context_window: {
      context_window_size: capacity, current_usage: current,
      used_percentage: Math.round(usedInput * 100 / capacity),
      remaining_percentage: 100 - Math.round(usedInput * 100 / capacity),
      total_input_tokens: usedInput, total_output_tokens: current.output_tokens,
    },
    cost: { total_cost_usd: 0, total_duration_ms: 0 },
    // Avoid unrelated network fallback; no other rendered percentages.
    rate_limits: {
      five_hour: { used_percentage: 0, resets_at: 4_000_000_000 },
      seven_day: { used_percentage: 0, resets_at: 4_000_000_000 },
    },
    exceeds_200k_tokens: true,
  };
  // Allow-list plumbing rather than inherit host behavior switches (including
  // CLAUDE_CODE_AUTO_COMPACT_WINDOW / DISABLE_* / CLAUDE_CONFIG_DIR).
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home, TERM: "xterm-256color", LANG: "en_US.UTF-8",
    LC_CTYPE: "en_US.UTF-8", COLUMNS: "234", STATUSLINE_APPEARANCE: "dark",
    ...o.env,
  };
  function render() {
    const proc = Bun.spawnSync(["bash", SCRIPT], {
      cwd: project, stdin: Buffer.from(JSON.stringify(payload)), env, timeout: 10_000,
    });
    expect(proc.stderr.toString()).toBe("");
    expect(proc.exitCode).toBe(0);
    const visible = proc.stdout.toString().replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
    // Select only ctx's bar/percentage/size/bolt, not dynamic RAM/git/etc.
    // Plan percentages carry 5h:/7d: prefixes, so cannot match this bar prefix.
    const ctx = visible.match(/[█░▀▄▌▐▓▒▁▂▃▅▆▇━─-]+\s+\d+%(?:\s+\d+(?:\.\d+)?[kM](?:\/\d+(?:\.\d+)?[kM])?(?:\|\d+(?:\.\d+)?[kM])?\+?)?(?:\s+⚡)?/u);
    expect(ctx, `missing ctx section in ${JSON.stringify(visible)}`).not.toBeNull();
    return ctx![0].trim();
  }
  function config(enabled: boolean) {
    json(join(home, ".claude", "statusline-config.json"), { context_autocompact: enabled });
  }
  return { home, project, payload, env, render, config };
}
function expectWindow(ctx: string, percent: number, label: string) {
  expect(ctx).toMatch(new RegExp(`(?:^|\\s)${percent}%(?:\\s|$)`));
  expect(ctx).toContain(label);
  expect(ctx).not.toContain("1M+");
}
function unchanged(o: Options) {
  const s = setup(o);
  const actual = s.render();
  s.config(false);
  expect(actual).toBe(s.render());
}

describe("MTL-317 auto-compact context measurement", () => {
  test("REQ-1 REQ-7 REQ-8: default on renders user's 355k usage as 97%, dual window and bolt", () => {
    const s = setup({ user: modelWindow(400_000) });
    const ctx = s.render();
    expectWindow(ctx, 97, "355k/400k|1M");
    // The spec preserves existing bar rounding; its example is not a cell-count contract.
    // render() already requires a visible bar beside the specified percentage.
    expect(ctx).toContain("⚡");
  });

  const resolution: { name: string; req: string; o: Options; window: number }[] = [
    { name: "top-level only", req: "REQ-2", o: { user: { autoCompactWindow: 500_000 } }, window: 500_000 },
    { name: "per-model beats top-level", req: "REQ-2", o: { user: { autoCompactWindow: 600_000, ...modelWindow(400_000) } }, window: 400_000 },
    { name: "project beats user", req: "REQ-2", o: { user: modelWindow(600_000), project: modelWindow(400_000) }, window: 400_000 },
    { name: "local beats project", req: "REQ-2", o: { project: modelWindow(600_000), local: modelWindow(400_000) }, window: 400_000 },
    { name: "later top-level resets earlier model map", req: "REQ-2", o: { user: modelWindow(400_000), project: { autoCompactWindow: 500_000 } }, window: 500_000 },
    { name: "model-only layer preserves other earlier model entries", req: "REQ-2", o: { user: modelWindow(400_000), project: modelWindow(600_000, "claude-sonnet-4-6") }, window: 400_000 },
    { name: "env bare digits beats settings", req: "REQ-3", o: { user: modelWindow(600_000), local: modelWindow(500_000), env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "400000" } }, window: 400_000 },
    { name: "env 200k parses", req: "REQ-3", o: { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200k" }, input: 80_000, creation: 10_000, read: 10_000, output: 5_000 }, window: 200_000 },
    { name: "env uppercase K parses", req: "REQ-3", o: { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "400K" } }, window: 400_000 },
    { name: "env lower bound clamps to 100000", req: "REQ-3", o: { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "1" }, input: 30_000, creation: 0, read: 0, output: 5_000 }, window: 100_000 },
    { name: "env upper bound clamps to 1M", req: "REQ-3", o: { capacity: 2_000_000, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "9m" } }, window: 1_000_000 },
    { name: "env 1m parses below larger context", req: "REQ-3", o: { capacity: 2_000_000, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "1m" } }, window: 1_000_000 },
    { name: "invalid env falls through to settings", req: "REQ-3", o: { user: modelWindow(400_000), env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "nope" } }, window: 400_000 },
    { name: "workspace absent falls back to cwd", req: "REQ-5", o: { project: modelWindow(400_000), workspace: false }, window: 400_000 },
  ];
  for (const c of resolution) {
    test(`${c.req}: resolves ${c.name} to the specified window`, () => {
      const s = setup(c.o);
      const u = s.payload.context_window.current_usage;
      const used = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens + u.output_tokens;
      expectWindow(s.render(), Math.round(used * 100 / (c.window - 33_000)),
        c.window === 1_000_000 ? "1M|2M" : `${c.window / 1000}k|1M`);
    });
  }
  for (const id of [
    "CLAUDE-OPUS-5-5[1m]", "claude-opus-5-5-20261029",
    "us.anthropic.claude-opus-5-5-v1:0", "claude-opus-5-5@20261029",
  ]) {
    test(`REQ-4: canonicalizes model id ${id}`, () => {
      expectWindow(setup({ model: id, user: modelWindow(400_000) }).render(), 97, "355k/400k|1M");
    });
    test(`REQ-4: canonicalizes settings key ${id}`, () => {
      expectWindow(setup({ user: modelWindow(400_000, id) }).render(), 97, "355k/400k|1M");
    });
  }
  test("REQ-4: exact settings key beats an earlier folded key", () => {
    expectWindow(setup({ user: {
      modelSettings: {
        "claude-opus-5-5-20261029": { autoCompactWindow: 600_000 },
        [MODEL]: { autoCompactWindow: 400_000 },
      },
    } }).render(), 97, "355k/400k|1M");
  });
  for (const flag of ["DISABLE_AUTO_COMPACT", "DISABLE_COMPACT"]) {
    test(`REQ-6: env window still applies with ${flag}=1`, () => {
      expectWindow(setup({ user: modelWindow(600_000), env: {
        [flag]: "1", CLAUDE_CODE_AUTO_COMPACT_WINDOW: "400k",
      } }).render(), 97, "355k/400k|1M");
    });
  }
  test("REQ-6: env window still applies when autoCompactEnabled is false", () => {
    expectWindow(setup({ global: { autoCompactEnabled: false }, env: {
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: "400k",
    } }).render(), 97, "355k/400k|1M");
  });

  const fallback: [string, Options][] = [
    ['"auto"', { user: { autoCompactWindow: "auto" } }],
    ["unset", {}],
    ["non-integer", { user: { autoCompactWindow: 400_000.5 } }],
    ["window equal to context", { user: modelWindow(1_000_000) }],
    ["window larger than context", { user: modelWindow(1_500_000) }],
    ["DISABLE_AUTO_COMPACT", { user: modelWindow(400_000), env: { DISABLE_AUTO_COMPACT: "1" } }],
    ["DISABLE_COMPACT", { user: modelWindow(400_000), env: { DISABLE_COMPACT: "1" } }],
    ["global autoCompactEnabled false", { user: modelWindow(400_000), global: { autoCompactEnabled: false } }],
  ];
  for (const [name, o] of fallback) {
    test(`REQ-6 REQ-9: ${name} preserves model-window ctx output`, () => unchanged(o));
  }
  test("REQ-9: explicit config false restores the same ctx as absent window", () => {
    const s = setup({ user: modelWindow(400_000) });
    expectWindow(s.render(), 97, "355k/400k|1M");
    s.config(false);
    const disabled = s.render();
    // Same stdin, HOME and project; remove the settings window to establish baseline.
    json(join(s.home, ".claude", "settings.json"), {});
    expect(s.render()).toBe(disabled);
    expect(disabled).not.toContain("400k|1M");
    expect(disabled).not.toMatch(/\b97%/);
  });

  test("REQ-7 REQ-8: below 50% always shows window but not used count or bolt", () => {
    const ctx = setup({ user: modelWindow(400_000), input: 80_000, creation: 10_000, read: 10_000, output: 5_000 }).render();
    expectWindow(ctx, 29, "400k|1M");
    expect(ctx).not.toContain("/");
    expect(ctx).not.toContain("⚡");
  });
  test("REQ-7: zero usage renders 0%, not a negative percentage", () => {
    expectWindow(setup({ user: modelWindow(400_000), input: 0, creation: 0, read: 0, output: 0 }).render(), 0, "400k|1M");
  });
  for (const [used, percent, bolt] of [[289_930, 79, false], [293_600, 80, true]] as const) {
    test(`REQ-8: ${percent}% uses the auto-compact bolt threshold`, () => {
      const ctx = setup({ user: modelWindow(400_000), input: used, creation: 0, read: 0, output: 0 }).render();
      expectWindow(ctx, percent, "400k|1M");
      expect(ctx.includes("⚡")).toBe(bolt);
    });
  }

  test("REQ-10: second render reuses settings until a newer mtime refreshes it", () => {
    const s = setup({ user: modelWindow(400_000) });
    const path = join(s.home, ".claude", "settings.json");
    const old = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
    utimesSync(path, old, old);
    expectWindow(s.render(), 97, "355k/400k|1M");
    const original = statSync(path);
    // Same-signature changed content distinguishes a cache hit from recomputation,
    // without inspecting private cache contents or asserting internal jq invocations.
    json(path, modelWindow(500_000));
    utimesSync(path, original.atime, original.mtime);
    expectWindow(s.render(), 97, "355k/400k|1M");
    const newer = new Date(original.mtimeMs + 10_000);
    utimesSync(path, newer, newer);
    expectWindow(s.render(), 76, "355k/500k|1M");
  });
  test("REQ-10: changing env on a cached session takes effect immediately", () => {
    const s = setup({ user: modelWindow(400_000) });
    expectWindow(s.render(), 97, "355k/400k|1M");
    s.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = "500k";
    expectWindow(s.render(), 76, "355k/500k|1M");
    delete s.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
    expectWindow(s.render(), 97, "355k/400k|1M");
  });
});
