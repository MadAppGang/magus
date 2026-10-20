import { afterEach, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const PLUGIN_ROOT = join(import.meta.dir, "..", "..");
export const SETUP = join(PLUGIN_ROOT, "scripts", "setup.ts");
export const HOOK = join(PLUGIN_ROOT, "hooks", "offer-setup.ts");
export const SKILL = join(PLUGIN_ROOT, "skills", "setup", "SKILL.md");
export const ENGINE_IDS = ["codegraph", "graphify", "mnemex", "serena"] as const;

export interface Site {
  root: string;
  home: string;
  project: string;
  bin: string;
  shimDir: string;
  marker: string;
  userSettings: string;
  projectSettings: string;
  localSettings: string;
  env: Record<string, string>;
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

export function site(): Site {
  const root = mkdtempSync(join(tmpdir(), "code-search-setup-qa-"));
  roots.push(root);
  const home = join(root, "home");
  const project = join(root, "project");
  const bin = join(root, "bin");
  const shimDir = join(home, ".local", "bin");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(project, ".claude"), { recursive: true });
  mkdirSync(bin);
  mkdirSync(shimDir, { recursive: true });
  return {
    root, home, project, bin, shimDir, marker: join(root, "executed"),
    userSettings: join(home, ".claude", "settings.json"),
    projectSettings: join(project, ".claude", "settings.json"),
    localSettings: join(project, ".claude", "settings.local.json"),
    // Do not inherit the user's HOME, env-file, credentials, package manager config, or proxies.
    env: {
      HOME: home,
      CLAUDE_PROJECT_DIR: project,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
      PATH: [shimDir, bin].join(":"),
    },
  };
}

export function settings(path: string, value: object): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function codeSearch(path: string, value: object): void {
  settings(path, { "code-search": value });
}

export function readSettings(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Fake lookup succeeds, but running the binary leaves a conspicuous trace. */
export function fakeExecutable(s: Site, name: string): string {
  const path = join(s.bin, name);
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' '${name}' >> '${s.marker}'\nexit 0\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

export type FakeMagusMode = "render" | "fail" | "noop" | "fail-second";

/**
 * A stand-in `magus` on the site's PATH. Every call appends one JSON line
 * `{ argv, cwd }` to `s.marker`, so `assertNotExecuted` still proves it never ran.
 *   render       regenerates `.claude/settings.json` in its cwd the way magus does:
 *                existing enabledPlugins plus `profiles[<active>].settings`.
 *   fail         writes stderr and exits 3.
 *   noop         exits 0 and writes nothing.
 *   fail-second  renders on every call except the second, which fails like `fail`.
 * The interpreter line names the absolute bun path, so bun need not be on PATH.
 */
export function fakeMagus(s: Site, mode: FakeMagusMode): string {
  const path = join(s.bin, "magus");
  const script = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const record = ${JSON.stringify(s.marker)};
const mode = ${JSON.stringify(mode)};
const calls = fs.existsSync(record) ? fs.readFileSync(record, "utf8").split("\\n").filter(Boolean).length : 0;
fs.appendFileSync(record, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + "\\n");
if (mode === "fail" || (mode === "fail-second" && calls === 1)) {
  process.stderr.write("fake magus: render failed\\n");
  process.exit(3);
}
if (mode === "noop") process.exit(0);
const claude = path.join(process.cwd(), ".claude");
const active = JSON.parse(fs.readFileSync(path.join(claude, "profiles", "active.json"), "utf8")).profile;
const manifest = JSON.parse(fs.readFileSync(path.join(claude, "profiles.json"), "utf8"));
const live = path.join(claude, "settings.json");
const current = fs.existsSync(live) ? JSON.parse(fs.readFileSync(live, "utf8")) : {};
const rendered = { enabledPlugins: current.enabledPlugins ?? {}, ...(manifest.profiles[active].settings ?? {}) };
fs.writeFileSync(live, JSON.stringify(rendered, null, 2) + "\\n");
process.exit(0);
`;
  writeFileSync(path, script, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

/** Each recorded `magus` call, in order. Empty when magus never ran. */
export function magusCalls(s: Site): { argv: string[]; cwd: string }[] {
  if (!existsSync(s.marker)) return [];
  return readFileSync(s.marker, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

export function foreignShim(s: Site, owner = "someone-else"): string {
  const path = join(s.shimDir, "rg");
  writeFileSync(path, `#!/bin/sh\n# OWNER=${owner}\n# VERSION=0\nexit 0\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

export function routed(s: Site, engine = "codegraph", marker = true): void {
  const command = fakeExecutable(s, engine);
  codeSearch(s.projectSettings, {
    engine, setup: "active", engines: { [engine]: { command, args: [] } },
  });
  if (marker) {
    const relative: Record<string, string | undefined> = {
      mnemex: ".mnemex/index.db", codegraph: ".codegraph/codegraph.db",
      graphify: "graphify-out/graph.json", serena: undefined,
    };
    const target = relative[engine];
    if (target) {
      mkdirSync(dirname(join(s.project, target)), { recursive: true });
      writeFileSync(join(s.project, target), "marker");
    }
  }
}

export interface CliOutput {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  json: Record<string, any>;
}

export function cli(s: Site, args: string[], env: Record<string, string> = s.env): CliOutput {
  const result = spawnSync(process.execPath,
    ["--env-file=/dev/null", "--config=/dev/null", SETUP, ...args, "--json", "--project", s.project],
    { cwd: existsSync(s.project) ? s.project : s.root, env, encoding: "utf8", timeout: 15_000 });
  if (result.error) throw result.error;
  const stdout = result.stdout ?? "";
  const json = JSON.parse(stdout) as Record<string, any>;
  expect(json.exitCode).toBe(result.status);
  return { exitCode: result.status, stdout, stderr: result.stderr ?? "", json };
}

export function status(s: Site): { headline: string; codes: string[]; output: CliOutput } {
  const output = cli(s, ["status"]);
  expect(output.exitCode).toBe(0);
  expect(output.json.command).toBe("status");
  expect(output.json.ok).toBe(true);
  const report = output.json.data?.report;
  expect(report).toBeDefined();
  const state = typeof report.state === "object" && report.state !== null ? report.state : report;
  expect(typeof state.headline).toBe("string");
  expect(Array.isArray(state.findings)).toBe(true);
  return { headline: state.headline, codes: state.findings.map((f: {code: string}) => f.code), output };
}

export function hook(s: Site): { exitCode: number | null; stdout: string; stderr: string } {
  const input = JSON.stringify({
    hook_event_name: "SessionStart", source: "startup", cwd: s.project, session_id: "t",
  });
  const result = spawnSync(process.execPath,
    ["--env-file=/dev/null", "--config=/dev/null", HOOK],
    { cwd: s.project, env: s.env, input, encoding: "utf8", timeout: 15_000 });
  if (result.error) throw result.error;
  return { exitCode: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function assertNotExecuted(s: Site): void {
  expect(existsSync(s.marker)).toBe(false);
}
