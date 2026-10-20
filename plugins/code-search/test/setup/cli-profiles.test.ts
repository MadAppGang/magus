import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type Site, assertNotExecuted, cli, fakeMagus, magusCalls, readSettings, settings, site } from "./support";

// REGRESSION: configure/dismiss at the project layer wrote magus-generated settings.json instead of the active profile in profiles.json — Fixed in /dev:fix session dev-fix-20261020-cs-profile-layer

const enabled = { enabledPlugins: { "code-search@magus": true } };

interface Profiled extends Site {
  profiles: string;
}

/** A magus-profiled project: profiles.json v2 with profile `default`, active in this checkout. */
function profiledSite(): Profiled {
  const s = site();
  const profiles = join(s.project, ".claude", "profiles.json");
  settings(profiles, {
    version: 2,
    default: "default",
    profiles: {
      default: { name: "Default", plugins: { "code-search@magus": true }, settings: { model: "opus" } },
    },
  });
  mkdirSync(join(s.project, ".claude", "profiles"), { recursive: true });
  settings(join(s.project, ".claude", "profiles", "active.json"), { profile: "default" });
  settings(s.projectSettings, { ...enabled, model: "opus" });
  return { ...s, profiles };
}

function profileBlock(s: Profiled): Record<string, any> | undefined {
  return readSettings(s.profiles).profiles.default.settings?.["code-search"];
}

describe("project layer in a magus-profiled project", () => {
  test("configure --layer project writes the active profile in profiles.json, then magus regenerates settings.json", () => {
    const s = profiledSite();
    fakeMagus(s, "render");
    const output = cli(s, ["configure", "codegraph", "--layer", "project"]);
    expect(output.exitCode).toBe(0);
    expect(output.json.ok).toBe(true);

    const block = profileBlock(s);
    expect(block?.engine).toBe("codegraph");
    expect(block?.setup).toBe("active");
    expect(typeof block?.engines?.codegraph?.command).toBe("string");
    expect(readSettings(s.projectSettings)["code-search"]).toEqual(block);

    const project = realpathSync(s.project);
    const listed = magusCalls(s).filter((call) => call.argv.join(" ") === "profile list");
    expect(listed.length).toBeGreaterThan(0);
    for (const call of listed) expect(realpathSync(call.cwd)).toBe(project);
    expect(output.json.data.path).toBe(s.profiles);
  });

  test("dismiss with no --layer writes setup dismissed into the active profile", () => {
    const s = profiledSite();
    fakeMagus(s, "render");
    const output = cli(s, ["dismiss"]);
    expect(output.exitCode).toBe(0);
    expect(output.json.ok).toBe(true);
    expect(profileBlock(s)?.setup).toBe("dismissed");
  });
});

function bytes(path: string): string {
  return readFileSync(path, "utf8");
}

describe("project layer in a magus-profiled project: refusals and failures", () => {
  test("magus not on PATH: magus_missing, nothing written", () => {
    const s = profiledSite();
    const profilesBefore = bytes(s.profiles);
    const settingsBefore = bytes(s.projectSettings);
    const output = cli(s, ["configure", "codegraph", "--layer", "project"]);
    expect(output.exitCode).toBe(1);
    expect(output.json.failure.code).toBe("magus_missing");
    expect(output.json.failure.remedy).toContain("--layer local");
    expect(bytes(s.profiles)).toBe(profilesBefore);
    expect(bytes(s.projectSettings)).toBe(settingsBefore);
  });

  test("magus fails before the write: profile_render_failed, nothing written", () => {
    const s = profiledSite();
    fakeMagus(s, "fail");
    const profilesBefore = bytes(s.profiles);
    const settingsBefore = bytes(s.projectSettings);
    const output = cli(s, ["configure", "codegraph", "--layer", "project"]);
    expect(output.exitCode).toBe(1);
    expect(output.json.failure.code).toBe("profile_render_failed");
    expect(output.json.failure.message).toContain("nothing was written");
    expect(output.json.failure.process.exitCode).toBe(3);
    expect(output.json.failure.process.stderrTail.join("\n")).toContain("render failed");
    expect(bytes(s.profiles)).toBe(profilesBefore);
    expect(bytes(s.projectSettings)).toBe(settingsBefore);
    expect(magusCalls(s).length).toBe(1);
  });

  test("magus fails after the write: profile_render_failed, profiles.json written, settings.json not", () => {
    const s = profiledSite();
    fakeMagus(s, "fail-second");
    const settingsBefore = bytes(s.projectSettings);
    const output = cli(s, ["configure", "codegraph", "--layer", "project"]);
    expect(output.exitCode).toBe(1);
    expect(output.json.ok).toBe(false);
    expect(output.json.failure.code).toBe("profile_render_failed");
    expect(output.json.failure.message).toContain(`Wrote profile "default" in ${s.profiles}`);
    expect(output.json.failure.path).toBe(s.profiles);
    expect(output.json.failure.remedy).toContain("magus profile list");
    expect(output.json.data.changed).toBe(true);
    expect(profileBlock(s)?.engine).toBe("codegraph");
    expect(bytes(s.projectSettings)).toBe(settingsBefore);
    expect(magusCalls(s).length).toBe(2);
  });

  test("magus exits 0 but does not render the value: profile_not_rendered", () => {
    const s = profiledSite();
    fakeMagus(s, "noop");
    const output = cli(s, ["configure", "codegraph", "--layer", "project"]);
    expect(output.exitCode).toBe(1);
    expect(output.json.failure.code).toBe("profile_not_rendered");
    expect(output.json.failure.message).toContain(s.profiles);
    expect(output.json.failure.message).toContain(s.projectSettings);
    expect(profileBlock(s)?.engine).toBe("codegraph");
    expect(readSettings(s.projectSettings)["code-search"]).toBeUndefined();
  });

  test("no active-profile marker: profile_not_active naming magus update; magus never runs", () => {
    const s = profiledSite();
    fakeMagus(s, "render");
    rmSync(join(s.project, ".claude", "profiles", "active.json"));
    const profilesBefore = bytes(s.profiles);
    const output = cli(s, ["configure", "codegraph", "--layer", "project"]);
    expect(output.exitCode).toBe(1);
    expect(output.json.failure.code).toBe("profile_not_active");
    expect(output.json.failure.remedy).toContain("magus update");
    expect(bytes(s.profiles)).toBe(profilesBefore);
    assertNotExecuted(s);
  });

  test("marker names a profile profiles.json lacks: remedy names magus profile switch; magus never runs", () => {
    const s = profiledSite();
    fakeMagus(s, "render");
    settings(join(s.project, ".claude", "profiles", "active.json"), { profile: "ghost" });
    const profilesBefore = bytes(s.profiles);
    const output = cli(s, ["dismiss"]);
    expect(output.exitCode).toBe(1);
    expect(output.json.failure.code).toBe("profile_not_active");
    expect(output.json.failure.message).toContain('"ghost"');
    expect(output.json.failure.remedy).toContain("magus profile switch");
    expect(output.json.failure.remedy).toContain("default");
    expect(bytes(s.profiles)).toBe(profilesBefore);
    assertNotExecuted(s);
  });
});

describe("other layers and modes in a magus-profiled project", () => {
  test("--layer local writes settings.local.json as before; profiles.json unchanged, magus not run", () => {
    const s = profiledSite();
    fakeMagus(s, "render");
    const profilesBefore = bytes(s.profiles);
    const output = cli(s, ["configure", "codegraph", "--layer", "local"]);
    expect(output.exitCode).toBe(0);
    expect(output.json.data.path).toBe(s.localSettings);
    expect(readSettings(s.localSettings)["code-search"].engine).toBe("codegraph");
    expect(bytes(s.profiles)).toBe(profilesBefore);
    assertNotExecuted(s);
  });

  test("--layer user writes the user settings as before; profiles.json unchanged, magus not run", () => {
    const s = profiledSite();
    fakeMagus(s, "render");
    const profilesBefore = bytes(s.profiles);
    const output = cli(s, ["configure", "none", "--layer", "user"]);
    expect(output.exitCode).toBe(0);
    expect(output.json.data.path).toBe(s.userSettings);
    expect(readSettings(s.userSettings)["code-search"].engine).toBe(false);
    expect(bytes(s.profiles)).toBe(profilesBefore);
    assertNotExecuted(s);
  });

  test("--dry-run --layer project writes nothing, runs no magus, and names profiles.json", () => {
    const s = profiledSite();
    fakeMagus(s, "render");
    const profilesBefore = bytes(s.profiles);
    const settingsBefore = bytes(s.projectSettings);
    const output = cli(s, ["configure", "codegraph", "--layer", "project", "--dry-run"]);
    expect(output.exitCode).toBe(0);
    expect(output.json.dryRun).toBe(true);
    expect(output.json.actions.length).toBeGreaterThan(0);
    for (const action of output.json.actions) expect(action).toContain(s.profiles);
    expect(bytes(s.profiles)).toBe(profilesBefore);
    expect(bytes(s.projectSettings)).toBe(settingsBefore);
    assertNotExecuted(s);
  });

  test("a different engines block in the profile: engine_block_differs; --replace overwrites it", () => {
    const s = profiledSite();
    fakeMagus(s, "render");
    const manifest = readSettings(s.profiles);
    manifest.profiles.default.settings["code-search"] = { engines: { codegraph: { command: "my-codegraph", args: [] } } };
    settings(s.profiles, manifest);

    const refused = cli(s, ["configure", "codegraph", "--layer", "project"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.json.failure.code).toBe("engine_block_differs");
    expect(refused.json.failure.message).toContain(s.profiles);
    expect(profileBlock(s)?.engines.codegraph.command).toBe("my-codegraph");

    const replaced = cli(s, ["configure", "codegraph", "--layer", "project", "--replace"]);
    expect(replaced.exitCode).toBe(0);
    expect(profileBlock(s)?.engines.codegraph.command).not.toBe("my-codegraph");
    expect(readSettings(s.projectSettings)["code-search"]).toEqual(profileBlock(s));
  });

  test("the local layer shadows the value: layer_shadowed naming settings.local.json, nothing written", () => {
    const s = profiledSite();
    fakeMagus(s, "render");
    settings(s.localSettings, { "code-search": { engine: "mnemex" } });
    const profilesBefore = bytes(s.profiles);
    const output = cli(s, ["configure", "codegraph", "--layer", "project"]);
    expect(output.exitCode).toBe(1);
    expect(output.json.failure.code).toBe("layer_shadowed");
    expect(output.json.failure.path).toBe(s.localSettings);
    expect(output.json.failure.remedy).toContain("--layer local");
    expect(bytes(s.profiles)).toBe(profilesBefore);
    expect(readSettings(s.projectSettings)["code-search"]).toBeUndefined();
  });
});

describe("project layer in a magus-profiled project: what the outcome reports", () => {
  test("a successful write runs magus profile list exactly twice: preflight and post-write", () => {
    const s = profiledSite();
    fakeMagus(s, "render");
    const output = cli(s, ["configure", "codegraph", "--layer", "project"]);
    expect(output.exitCode).toBe(0);
    const listed = magusCalls(s).filter((call) => call.argv.join(" ") === "profile list");
    expect(listed.length).toBe(2);
    expect(magusCalls(s).length).toBe(2);
  });

  test("profile already says it but settings.json was stale: the preflight regenerate is reported and needs a restart", () => {
    const s = profiledSite();
    fakeMagus(s, "render");
    expect(cli(s, ["configure", "none", "--layer", "project"]).exitCode).toBe(0);
    const target = profileBlock(s);
    expect(target?.engine).toBe(false);

    // settings.json goes stale: it still routes to codegraph, the profile says no engine.
    const stale = readSettings(s.projectSettings);
    stale["code-search"] = { engine: "codegraph", setup: "active", engines: { codegraph: { command: "codegraph", args: [] } } };
    settings(s.projectSettings, stale);
    const profilesBefore = bytes(s.profiles);

    const output = cli(s, ["configure", "none", "--layer", "project"]);
    expect(output.exitCode).toBe(0);
    expect(output.json.ok).toBe(true);
    expect(output.json.restartRequired).toBe(true);
    expect(output.json.summary).not.toContain("nothing written");
    expect(output.json.actions.some((action: string) => action.includes("regenerated") && action.includes(s.projectSettings))).toBe(true);
    expect(readSettings(s.projectSettings)["code-search"]).toEqual(target);
    expect(bytes(s.profiles)).toBe(profilesBefore);
  });

  test("a refusal after the preflight names profiles.json, not an absolute nothing-was-written", () => {
    const s = profiledSite();
    fakeMagus(s, "render");
    settings(s.localSettings, { "code-search": { engine: "mnemex" } });
    const output = cli(s, ["configure", "codegraph", "--layer", "project"]);
    expect(output.exitCode).toBe(1);
    expect(output.json.failure.code).toBe("layer_shadowed");
    expect(output.json.failure.message).toContain(`Nothing was written to ${s.profiles}.`);
    expect(output.json.failure.message).not.toMatch(/Nothing was written\.$/);
  });

  test("a dry-run refusal keeps its wording: no magus ran, so no written-to claim is added", () => {
    const s = profiledSite();
    fakeMagus(s, "render");
    settings(s.localSettings, { "code-search": { engine: "mnemex" } });
    const output = cli(s, ["configure", "codegraph", "--layer", "project", "--dry-run"]);
    expect(output.exitCode).toBe(1);
    expect(output.json.failure.code).toBe("layer_shadowed");
    expect(output.json.failure.message).not.toContain("Nothing was written");
    assertNotExecuted(s);
  });
});
