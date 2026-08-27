/**
 * Tests for the layered settings reader.
 *
 * No filesystem: `SettingsIo` is injected, so every layer is a string in a map. The
 * load-bearing assertion is the wholesale `engines.<id>` replacement — if `env` merged
 * per key, a project layer could only ever ADD a variable and never remove one set in
 * the home layer, and the entry you read in the winning file would not be the entry
 * that runs.
 *
 * Run: bun test plugins/code-analysis/mcp/core/settings.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  CALL_TIMEOUT_CEILING_MS,
  DEFAULTS,
  loadSettings,
  mergeSettingsLayers,
  PROJECT_DIR_UNSET,
  settingsLayerPaths,
  type SettingsIo,
} from "./settings";

const HOME = "/fixture/home";
const PROJECT = "/fixture/project";

const [HOME_LAYER, PROJECT_LAYER, LOCAL_LAYER] = settingsLayerPaths(HOME, PROJECT) as [
  string,
  string,
  string,
];

type Files = Record<string, string | (() => never)>;

function reader(files: Files): (path: string) => string | undefined {
  return (path) => {
    const entry = files[path];
    if (entry === undefined) return undefined;
    return typeof entry === "function" ? entry() : entry;
  };
}

function io(files: Files): SettingsIo {
  return { home: HOME, projectDir: PROJECT, readFileText: reader(files) };
}

/** No CLAUDE_PROJECT_DIR: the two project layers are never consulted. */
function ioNoProject(files: Files): SettingsIo {
  return { home: HOME, readFileText: reader(files) };
}

function block(value: unknown): string {
  return JSON.stringify({ "code-analysis": value });
}

describe("settingsLayerPaths", () => {
  test("returns three paths in precedence order, lowest first", () => {
    expect(settingsLayerPaths(HOME, PROJECT)).toEqual([
      `${HOME}/.claude/settings.json`,
      `${PROJECT}/.claude/settings.json`,
      `${PROJECT}/.claude/settings.local.json`,
    ]);
  });

  test("skips the project layers entirely when there is no project dir", () => {
    expect(settingsLayerPaths(HOME)).toEqual([`${HOME}/.claude/settings.json`]);
    expect(settingsLayerPaths(`${HOME}/`)).toEqual([`${HOME}/.claude/settings.json`]);
  });
});

describe("layer precedence", () => {
  test("a later layer wins at depth 1 and depth 2", () => {
    const { settings } = loadSettings(
      io({
        [HOME_LAYER]: block({ engine: "mnemex", limits: { default: 5, max: 50 } }),
        [PROJECT_LAYER]: block({ engine: "enginea" }),
        [LOCAL_LAYER]: block({ limits: { default: 7 } }),
      }),
    );
    expect(settings.engine).toBe("enginea");
    // depth 2: `default` moved, `max` survived from the home layer.
    expect(settings.limits).toEqual({ default: 7, max: 50 });
  });

  test("passthrough.enabled is overridable without resetting maxPerEngine", () => {
    const { settings } = loadSettings(
      io({
        [HOME_LAYER]: block({ passthrough: { enabled: false, maxPerEngine: 2 } }),
        [LOCAL_LAYER]: block({ passthrough: { enabled: true } }),
      }),
    );
    expect(settings.passthrough).toEqual({ enabled: true, maxPerEngine: 2, maxTotal: 6 });
  });

  test("engines.<id> is replaced WHOLESALE, env included", () => {
    const { settings } = loadSettings(
      io({
        [HOME_LAYER]: block({
          engines: {
            mnemex: { command: "mnemex", args: ["--mcp"], env: { FOO: "1", BAR: "2" } },
            enginea: { command: "enginea" },
          },
        }),
        [PROJECT_LAYER]: block({
          engines: { mnemex: { command: "mnemex", args: ["--mcp", "--verbose"] } },
        }),
      }),
    );
    // The winning entry is exactly what the winning file says: no env at all.
    expect(settings.engines["mnemex"]).toEqual({ command: "mnemex", args: ["--mcp", "--verbose"] });
    expect(settings.engines["mnemex"]?.env).toBeUndefined();
    // A key the higher layer did not mention survives untouched.
    expect(settings.engines["enginea"]).toEqual({ command: "enginea" });
  });
});

describe("layer statuses", () => {
  test("read", () => {
    const { layers } = loadSettings(io({ [HOME_LAYER]: block({ engine: "mnemex" }) }));
    expect(layers[0]).toEqual({ path: HOME_LAYER, status: "read" });
  });

  test("absent", () => {
    const { layers } = loadSettings(io({}));
    expect(layers.map((l) => l.status)).toEqual(["absent", "absent", "absent"]);
  });

  test("unreadable — an io that breaks its own no-throw contract", () => {
    const { layers, settings } = loadSettings(
      io({
        [HOME_LAYER]: () => {
          throw new Error("EACCES");
        },
        [PROJECT_LAYER]: block({ engine: "mnemex" }),
      }),
    );
    expect(layers[0]?.status).toBe("unreadable");
    // And it did not block the layers above it.
    expect(settings.engine).toBe("mnemex");
  });

  test("malformed neither throws nor blocks", () => {
    const { layers, settings, notes } = loadSettings(
      io({
        [HOME_LAYER]: "{ not json",
        [PROJECT_LAYER]: block({ engine: "enginea" }),
      }),
    );
    expect(layers[0]?.status).toBe("malformed");
    expect(settings.engine).toBe("enginea");
    expect(notes.some((n) => n.code === "settings_ignored" && n.message.includes(HOME_LAYER))).toBe(
      true,
    );
  });

  test("no-block is not an error", () => {
    const { layers, notes } = loadSettings(io({ [HOME_LAYER]: '{"other": {}}' }));
    expect(layers[0]?.status).toBe("no-block");
    expect(notes).toEqual([]);
  });

  test("wrong-shape, at the root and at the block", () => {
    expect(loadSettings(io({ [HOME_LAYER]: "[1,2,3]" })).layers[0]?.status).toBe("wrong-shape");
    expect(loadSettings(io({ [HOME_LAYER]: block("nope") })).layers[0]?.status).toBe("wrong-shape");
  });

  test("three rows are always reported, even with no project dir", () => {
    const { layers } = loadSettings(ioNoProject({ [HOME_LAYER]: block({}) }));
    expect(layers).toHaveLength(3);
    expect(layers[1]).toEqual({ path: PROJECT_DIR_UNSET, status: "absent" });
    expect(layers[2]).toEqual({ path: PROJECT_DIR_UNSET, status: "absent" });
  });
});

describe("post-merge validation", () => {
  test("an invalid engine id is dropped, a valid one is kept", () => {
    const { settings, dropped } = mergeSettingsLayers([
      {
        engines: {
          "claude-context": { command: "npx" }, // hyphen: rejected by the id pattern
          enginec: { command: "npx" },
          Mnemex: { command: "mnemex" }, // uppercase: rejected
        },
      },
    ]);
    expect(Object.keys(settings.engines)).toEqual(["enginec"]);
    expect(dropped).toContain("engines.claude-context");
    expect(dropped).toContain("engines.Mnemex");
  });

  test("an engine entry with no command is dropped", () => {
    const { settings, dropped } = mergeSettingsLayers([
      { engines: { mnemex: { args: ["--mcp"] }, enginea: { command: "  " } } },
    ]);
    expect(settings.engines).toEqual({});
    expect(dropped).toEqual(["engines.mnemex.command", "engines.enginea.command"]);
  });

  test("bad args drop args and keep the entry", () => {
    const { settings, dropped } = mergeSettingsLayers([
      { engines: { mnemex: { command: "mnemex", args: "--mcp" } } },
    ]);
    expect(settings.engines["mnemex"]).toEqual({ command: "mnemex" });
    expect(dropped).toEqual(["engines.mnemex.args"]);
  });

  test("no callTimeoutMs leaves the key off the spec entirely", () => {
    // The absence is what selects the transport's 30_000 ms default, so it has to be an
    // absence and not a materialised 30_000 — a written-out default is a second copy of
    // it that goes stale the moment the real one moves.
    const { settings, dropped } = mergeSettingsLayers([
      { engines: { serena: { command: "serena" } } },
    ]);
    expect(settings.engines["serena"]).toEqual({ command: "serena" });
    expect(settings.engines["serena"]).not.toHaveProperty("callTimeoutMs");
    expect(dropped).toEqual([]);
  });

  test("a valid callTimeoutMs survives, alongside the rest of the spec", () => {
    const { settings, dropped } = mergeSettingsLayers([
      { engines: { mnemex: { command: "mnemex", args: ["--mcp"], callTimeoutMs: 120_000 } } },
    ]);
    expect(settings.engines["mnemex"]).toEqual({
      command: "mnemex",
      args: ["--mcp"],
      callTimeoutMs: 120_000,
    });
    expect(dropped).toEqual([]);
  });

  test("the ceiling itself is accepted; one millisecond past it is not", () => {
    const ok = mergeSettingsLayers([
      { engines: { mnemex: { command: "mnemex", callTimeoutMs: CALL_TIMEOUT_CEILING_MS } } },
    ]);
    expect(ok.settings.engines["mnemex"]?.callTimeoutMs).toBe(CALL_TIMEOUT_CEILING_MS);
    expect(ok.dropped).toEqual([]);

    const over = mergeSettingsLayers([
      { engines: { mnemex: { command: "mnemex", callTimeoutMs: CALL_TIMEOUT_CEILING_MS + 1 } } },
    ]);
    expect(over.settings.engines["mnemex"]?.callTimeoutMs).toBeUndefined();
    expect(over.dropped).toEqual([`engines.mnemex.callTimeoutMs (${CALL_TIMEOUT_CEILING_MS + 1})`]);
  });

  test("an invalid callTimeoutMs is REJECTED, not clamped, and the note names the value", () => {
    // Clamping is right for `passthrough` and `limits` — a smaller budget still works.
    // It is wrong for a deadline: substituting 240_000 for a requested 600_000 would
    // leave the operator reading one number while another governs the call. That silent
    // mismatch is the entire reason this field exists, so an unusable value drops back
    // to the documented default and says which value it refused.
    const cases: readonly [unknown, string][] = [
      [0, "0"],
      [-1, "-1"],
      [1.5, "1.5"],
      [Number.NaN, "NaN"],
      [Number.POSITIVE_INFINITY, "Infinity"],
      ["120000", '"120000"'],
      [null, "null"],
      [true, "true"],
      [{ ms: 120_000 }, '{"ms":120000}'],
    ];

    for (const [value, rendered] of cases) {
      const { settings, dropped } = mergeSettingsLayers([
        { engines: { mnemex: { command: "mnemex", callTimeoutMs: value } } },
      ]);
      // The ENTRY survives: a bad deadline is not a reason to lose the engine.
      expect(settings.engines["mnemex"]).toEqual({ command: "mnemex" });
      expect(dropped).toEqual([`engines.mnemex.callTimeoutMs (${rendered})`]);
    }
  });

  test("a rejected callTimeoutMs reaches the operator as a degraded note quoting it", () => {
    const { notes } = loadSettings(
      io({ [HOME_LAYER]: block({ engines: { mnemex: { command: "mnemex", callTimeoutMs: 0 } } }) }),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.level).toBe("degraded");
    expect(notes[0]?.message).toContain("engines.mnemex.callTimeoutMs (0)");
  });

  test("the passthrough caps are ratchets: 9 clamps to 3", () => {
    const { settings, dropped } = mergeSettingsLayers([
      { passthrough: { enabled: true, maxPerEngine: 9, maxTotal: 99 } },
    ]);
    expect(settings.passthrough).toEqual({ enabled: true, maxPerEngine: 3, maxTotal: 6 });
    expect(dropped).toEqual(["passthrough.maxPerEngine", "passthrough.maxTotal"]);
  });

  test("limits clamp, and default never exceeds max", () => {
    const { settings } = mergeSettingsLayers([{ limits: { default: 500, max: 900 } }]);
    expect(settings.limits).toEqual({ default: 200, max: 200 });
  });

  test("a non-string engine name is dropped", () => {
    const { settings, dropped } = mergeSettingsLayers([{ engine: 7 }]);
    expect(settings.engine).toBeUndefined();
    expect(dropped).toEqual(["engine"]);
  });

  test("an engine naming an absent entry SURVIVES the merge", () => {
    // Blanking it here would leave the user with a tier-0-only tool list and no cause.
    // registry.ts is what turns this into a backend_unavailable note naming the id.
    const { settings, dropped } = mergeSettingsLayers([{ engine: "enginea", engines: {} }]);
    expect(settings.engine).toBe("enginea");
    expect(dropped).toEqual([]);
  });

  test("layers that said nothing leave the defaults standing", () => {
    const { settings, dropped } = mergeSettingsLayers([undefined, "not an object", null]);
    expect(settings).toEqual(DEFAULTS);
    expect(dropped).toEqual([]);
  });

  test("dropped values are reported as one degraded note, never a throw", () => {
    const { notes } = loadSettings(
      io({ [HOME_LAYER]: block({ passthrough: { maxPerEngine: 9 } }) }),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.level).toBe("degraded");
    expect(notes[0]?.code).toBe("settings_ignored");
    expect(notes[0]?.message).toContain("passthrough.maxPerEngine");
  });
});
