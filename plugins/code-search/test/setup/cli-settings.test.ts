import { describe, expect, test } from "bun:test";
import {
  chmodSync, existsSync, lstatSync, readFileSync, readlinkSync, statSync,
  symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  ENGINE_IDS, assertNotExecuted, cli, codeSearch, fakeExecutable,
  foreignShim, readSettings, routed, settings, site, status,
} from "./support";

const enabled = { enabledPlugins: { "code-search@magus": true } };

function success(output: ReturnType<typeof cli>, command: string, target?: string): void {
  expect(output.exitCode).toBe(0);
  expect(output.json.ok).toBe(true);
  expect(output.json.command).toBe(command);
  if (target !== undefined) expect(output.json.target).toBe(target);
}

function failure(output: ReturnType<typeof cli>, code: string, exitCode = 1, command?: string, target?: string): void {
  expect(output.exitCode).toBe(exitCode);
  expect(output.json.ok).toBe(false);
  expect(output.json.failure.code).toBe(code);
  if (command !== undefined) expect(output.json.command).toBe(command);
  if (target !== undefined) expect(output.json.target).toBe(target);
}

describe("install validation and planning", () => {
  test("non-dry mnemex install with empty PATH refuses the missing prerequisite", () => {
    const s = site();
    const output = cli(s, ["install", "mnemex"], { ...s.env, PATH: s.bin });
    failure(output, "prerequisite_missing", 1, "install", "mnemex");
    expect(output.json.failure.message).toContain("bun");
    expect(typeof output.json.failure.remedy).toBe("string");
    assertNotExecuted(s);
  });

  test("mnemex dry-run plans exact argv without running an install", () => {
    const s = site();
    expect(s.env.PATH.split(":")).toEqual([s.shimDir, s.bin]);
    expect(existsSync(join(s.bin, "mnemex"))).toBe(false);
    symlinkSync(process.execPath, join(s.bin, "bun"));
    const output = cli(s, ["install", "mnemex", "--dry-run"]);
    success(output, "install", "mnemex");
    expect(output.json.dryRun).toBe(true);
    const plan = JSON.stringify({ actions: output.json.actions, planned: output.json.planned, summary: output.json.summary });
    expect(plan.includes('["bun","install","-g","mnemex"]') ||
      plan.includes("bun install -g mnemex")).toBe(true);
    expect(plan).not.toContain("mnemex@latest");
    assertNotExecuted(s);
  });

  test("unknown near-match engine exits 2 and lists every shipped id", () => {
    const s = site();
    const output = cli(s, ["install", "mnemexx", "--dry-run"]);
    failure(output, "usage_error", 2, "install", "mnemexx");
    const diagnostic = `${output.json.failure.message} ${output.stderr}`;
    for (const id of ENGINE_IDS) expect(diagnostic).toContain(id);
    expect(diagnostic).toContain("mnemexx");
    expect(output.json.actions ?? []).toEqual([]);
    assertNotExecuted(s);
  });

  test("failed project step reports argv, exit code, final 20 stderr lines and remedy", () => {
    const s = site();
    routed(s, "codegraph", false);
    const binary = join(s.bin, "codegraph");
    const lines = Array.from({ length: 23 }, (_, index) => `printf 'line-${index + 1}\\n' >&2`).join("\n");
    writeFileSync(binary, `#!/bin/sh\n${lines}\nexit 7\n`, { mode: 0o755 });
    chmodSync(binary, 0o755);
    const output = cli(s, ["index", "codegraph"]);
    failure(output, "index_failed", 1, "index", "codegraph");
    const process = output.json.failure.process;
    expect(JSON.stringify(process.command)).toContain("codegraph");
    expect(JSON.stringify(process.command)).toContain("init");
    expect(JSON.stringify(process.command)).toContain("-y");
    expect(process.exitCode).toBe(7);
    expect(process.stderrTail).toHaveLength(20);
    expect(process.stderrTail[0]).toBe("line-4");
    expect(process.stderrTail[19]).toBe("line-23");
    expect(typeof output.json.failure.remedy).toBe("string");
  });
});

describe("settings writer across scopes", () => {
  test("configure preserves unrelated keys and selects the enabling project settings", () => {
    const s = site();
    settings(s.projectSettings, { ...enabled, model: "opus", env: { KEEP: "yes" }, unrelated: { deep: 7 } });
    const output = cli(s, ["configure", "codegraph"]);
    success(output, "configure", "codegraph");
    const written = readSettings(s.projectSettings);
    expect(written.model).toBe("opus");
    expect(written.unrelated).toEqual({ deep: 7 });
    expect(written.env.KEEP).toBe("yes");
    expect(written.enabledPlugins).toEqual(enabled.enabledPlugins);
    expect(written["code-search"].engine).toBe("codegraph");
    expect(written["code-search"].setup).toBe("active");
    expect(typeof written["code-search"].engines.codegraph.command).toBe("string");
    expect(existsSync(s.localSettings)).toBe(false);
  });

  test("most specific enabledPlugins scope wins: local over project over user", () => {
    for (const winner of ["local", "project", "user"] as const) {
      const s = site();
      settings(s.userSettings, enabled);
      if (winner !== "user") settings(s.projectSettings, enabled);
      if (winner === "local") settings(s.localSettings, enabled);
      success(cli(s, ["configure", "serena"]), "configure", "serena");
      const target = winner === "local" ? s.localSettings : winner === "project" ? s.projectSettings : s.userSettings;
      expect(readSettings(target)["code-search"].engine).toBe("serena");
      for (const other of [s.localSettings, s.projectSettings, s.userSettings]) {
        if (other !== target && existsSync(other)) expect(readSettings(other)["code-search"]).toBeUndefined();
      }
    }
  });

  for (const { name, args, command, target } of [
    { name: "configure mnemex", args: ["configure", "mnemex"], command: "configure", target: "mnemex" },
    { name: "dismiss", args: ["dismiss"], command: "dismiss", target: undefined },
  ]) {
    for (const invalid of ["project", "local", "user"] as const) {
      test(`${name} refuses malformed ${invalid} settings without writing any layer`, () => {
        const s = site();
        const paths = {
          project: s.projectSettings, local: s.localSettings, user: s.userSettings,
        };
        const invalidPath = paths[invalid];
        settings(invalid === "project" ? s.userSettings : s.projectSettings, enabled);
        writeFileSync(invalidPath, '{"enabledPlugins":{"code-search@magus":true}, BROKEN');
        const layers = [s.projectSettings, s.localSettings, s.userSettings];
        const before = layers.map((path) => existsSync(path) ? readFileSync(path) : null);

        const output = cli(s, args);
        failure(output, "settings_invalid", 1, command, target);
        expect(output.json.failure.message).toContain(invalidPath);
        expect(output.json.failure.message).toMatch(/JSON|parse|syntax|unexpected|expected/i);
        expect(output.json.failure.remedy).toBe(`Fix the JSON in ${invalidPath}, then run this again.`);
        for (const [index, path] of layers.entries()) {
          if (before[index] === null) expect(existsSync(path)).toBe(false);
          else expect(readFileSync(path)).toEqual(before[index]);
        }
      });
    }

    test(`${name} refuses a wrong-shaped user code-search block without writes`, () => {
      const s = site();
      settings(s.projectSettings, enabled);
      settings(s.userSettings, { "code-search": "not an object" });
      const projectBefore = readFileSync(s.projectSettings);
      const userBefore = readFileSync(s.userSettings);
      const output = cli(s, args);
      failure(output, "settings_invalid", 1, command, target);
      expect(output.json.failure.message).toContain(s.userSettings);
      expect(output.json.failure.remedy).toBe(`Fix the JSON in ${s.userSettings}, then run this again.`);
      expect(readFileSync(s.projectSettings)).toEqual(projectBefore);
      expect(readFileSync(s.userSettings)).toEqual(userBefore);
      expect(existsSync(s.localSettings)).toBe(false);
    });
  }

  test("repeated configuration is a no-op: original bytes and mtime survive", () => {
    const s = site();
    success(cli(s, ["configure", "serena"]), "configure", "serena");
    const before = readFileSync(s.localSettings);
    const past = new Date("2001-01-01T00:00:00Z");
    utimesSync(s.localSettings, past, past);
    const mtime = statSync(s.localSettings).mtimeMs;
    success(cli(s, ["configure", "serena"]), "configure", "serena");
    expect(readFileSync(s.localSettings)).toEqual(before);
    expect(statSync(s.localSettings).mtimeMs).toBe(mtime);
  });

  test("symlink is preserved; resolved target changes and retains its original mode", () => {
    const s = site();
    const target = join(s.root, "actual-settings.json");
    settings(target, { ...enabled, KEEP: "target" });
    chmodSync(target, 0o640);
    symlinkSync(target, s.projectSettings);
    success(cli(s, ["configure", "codegraph"]), "configure", "codegraph");
    expect(lstatSync(s.projectSettings).isSymbolicLink()).toBe(true);
    expect(readlinkSync(s.projectSettings)).toBe(target);
    expect(readSettings(target).KEEP).toBe("target");
    expect(readSettings(target)["code-search"].engine).toBe("codegraph");
    expect(statSync(target).mode & 0o777).toBe(0o640);
  });

  test("new settings files are private (0600)", () => {
    const s = site();
    success(cli(s, ["configure", "serena"]), "configure", "serena");
    expect(statSync(s.localSettings).mode & 0o777).toBe(0o600);
  });

  test("dismiss always writes project settings, then configure reactivates in the same layer", () => {
    const s = site();
    settings(s.userSettings, enabled);
    success(cli(s, ["dismiss"]), "dismiss");
    expect(existsSync(s.projectSettings)).toBe(false);
    expect(readSettings(s.localSettings)["code-search"].setup).toBe("dismissed");
    expect(readSettings(s.userSettings)["code-search"]).toBeUndefined();
    expect(status(s).headline).toBe("dismissed");
    const shadowed = cli(s, ["configure", "serena"]);
    failure(shadowed, "layer_shadowed", 1, "configure", "serena");
    expect(`${shadowed.json.failure.message} ${shadowed.json.failure.path ?? ""}`).toContain(s.localSettings);
    expect(status(s).headline).toBe("dismissed");
    success(cli(s, ["configure", "serena", "--layer", "local"]), "configure", "serena");
    expect(readSettings(s.localSettings)["code-search"]).toEqual(expect.objectContaining({ engine: "serena", setup: "active" }));
    expect(status(s).headline).not.toBe("dismissed");
  });

  test("project-enabled dismiss writes settings.json rather than local or user", () => {
    const s = site();
    settings(s.projectSettings, enabled);
    success(cli(s, ["dismiss"]), "dismiss");
    expect(readSettings(s.projectSettings)["code-search"].setup).toBe("dismissed");
    expect(existsSync(s.localSettings)).toBe(false);
    expect(existsSync(s.userSettings)).toBe(false);
    success(cli(s, ["configure", "serena"]), "configure", "serena");
    expect(readSettings(s.projectSettings)["code-search"]).toEqual(expect.objectContaining({ engine: "serena", setup: "active" }));
  });

  test("writing a shadowed project layer fails and names the winning local file", () => {
    const s = site();
    settings(s.projectSettings, enabled);
    codeSearch(s.localSettings, { engine: false, setup: "dismissed" });
    const output = cli(s, ["configure", "codegraph", "--layer", "project"]);
    failure(output, "layer_shadowed", 1, "configure", "codegraph");
    expect(`${output.json.failure.message} ${output.json.failure.path ?? ""}`).toContain(s.localSettings);
    expect(status(s).headline).toBe("dismissed");
  });
});

describe("none", () => {
  test("configure none never edits the machine-wide rg", () => {
    const s = site();
    settings(s.projectSettings, { ...enabled, env: { KEEP: "yes" } });
    const shim = foreignShim(s);
    const bytes = readFileSync(shim);
    success(cli(s, ["configure", "none"]), "configure", "none");
    const written = readSettings(s.projectSettings);
    expect(written["code-search"].engine).toBe(false);
    expect(written["code-search"].setup).toBe("active");
    expect(readFileSync(shim)).toEqual(bytes);
    expect(status(s).headline).toBe("none");
  });
});
