import { describe, expect, test } from "bun:test";
import { CATALOG } from "../adapters/catalog";
import { ENGINE_IDS } from "../adapters/index";
import { combineGateEnv, engineConfigured, gateSettings, mergeGate } from "./gate";

const open = { platform: "darwin", env: {}, route: true, engineConfigured: true };

describe("mergeGate", () => {
  test("open when every condition holds", () => {
    expect(mergeGate(open)).toBeUndefined();
    expect(mergeGate({ ...open, env: { CODE_SEARCH_MERGE: "1" } })).toBeUndefined();
  });

  test("each closed reason, in D12's order", () => {
    expect(mergeGate({ ...open, platform: "win32", env: { CODE_SEARCH_MERGE: "0" }, route: false })).toBe("win32");
    expect(mergeGate({ ...open, env: { CODE_SEARCH_MERGE: "0" }, route: false, engineConfigured: false })).toBe("kill-switch");
    expect(mergeGate({ ...open, route: false, engineConfigured: false })).toBe("route-off");
    expect(mergeGate({ ...open, engineConfigured: false })).toBe("no-engine");
  });

  test("only the exact value 0 is the kill switch", () => {
    for (const value of ["", "00", " 0", "false", "off"]) {
      expect(mergeGate({ ...open, env: { CODE_SEARCH_MERGE: value } })).toBeUndefined();
    }
  });
});

describe("combineGateEnv", () => {
  test("a 0 in any source closes, whatever the others say", () => {
    expect(combineGateEnv({ CODE_SEARCH_MERGE: "1" }, { CODE_SEARCH_MERGE: "0" })).toEqual({ CODE_SEARCH_MERGE: "0" });
    expect(combineGateEnv({ CODE_SEARCH_MERGE: "0" }, {})).toEqual({ CODE_SEARCH_MERGE: "0" });
    expect(combineGateEnv({}, { CODE_SEARCH_MERGE: "1" })).toEqual({ CODE_SEARCH_MERGE: "1" });
    expect(combineGateEnv({}, {})).toEqual({ CODE_SEARCH_MERGE: undefined });
  });
});

describe("gateSettings", () => {
  const layer = (value: unknown): string => JSON.stringify(value);

  test("defaults when no layer says anything", () => {
    expect(gateSettings([undefined, undefined, undefined])).toEqual({ route: true, env: {}, engineConfigured: false });
  });

  test("grep.route merges per key with the later layer winning", () => {
    expect(gateSettings([layer({ "code-search": { grep: { route: false } } }), undefined]).route).toBe(false);
    expect(gateSettings([
      layer({ "code-search": { grep: { route: false } } }),
      layer({ "code-search": { grep: { route: true } } }),
    ]).route).toBe(true);
  });

  test("top-level env merges per key, later wins; malformed layers say nothing", () => {
    expect(gateSettings([
      layer({ env: { CODE_SEARCH_MERGE: "0", OTHER: "x" } }),
      "{ not json",
      layer({ env: { CODE_SEARCH_MERGE: "1" } }),
    ]).env).toEqual({ CODE_SEARCH_MERGE: "1", OTHER: "x" });
    expect(gateSettings([layer({ env: ["x"] }), layer([1])]).env).toEqual({});
  });
});

// Review round 1, internal M3: one definition of "an engine is configured", shared by the
// server, the SessionStart hook, the redirect hook and setup status.
describe("engineConfigured", () => {
  test("an engine id with an engines entry, and nothing else", () => {
    expect(engineConfigured({ engine: "mnemex", engines: { mnemex: { command: "x" } } })).toBe(true);
    expect(engineConfigured({ engine: "mnemex", engines: {} })).toBe(false);
    expect(engineConfigured({ engine: false, engines: { mnemex: { command: "x" } } })).toBe(false);
    expect(engineConfigured({ engines: { mnemex: { command: "x" } } })).toBe(false);
  });

  // Review round 5, Codex CRITICAL: the server also needs a shipped adapter for the id
  // (`resolveEngine`); an entry for an unknown id built no engine and bound no socket, yet
  // the hooks counted it as configured (measured: {engineConfigured:true, adapterResolved:false}).
  test("an id with an entry but no shipped adapter is not configured", () => {
    expect(engineConfigured({ engine: "fake", engines: { fake: { command: "x" } } })).toBe(false);
    for (const id of ENGINE_IDS) expect(engineConfigured({ engine: id, engines: { [id]: { command: "x" } } })).toBe(true);
  });

  test("the ids it accepts are exactly the adapters the server can resolve", () => {
    expect(Object.keys(CATALOG).sort()).toEqual([...ENGINE_IDS].sort());
  });

  // Review round 4, internal LOW: `engines[id] !== undefined` saw Object.prototype, and
  // `constructor` passes the engine-id pattern.
  test("an id naming an inherited property is not configured", () => {
    expect(engineConfigured({ engine: "constructor", engines: {} })).toBe(false);
    expect(gateSettings([JSON.stringify({ "code-search": { engine: "constructor" } })]).engineConfigured).toBe(false);
  });

  test("gateSettings reports it from the merged layers", () => {
    const layer = (value: unknown): string => JSON.stringify(value);
    expect(gateSettings([layer({ "code-search": { engine: "mnemex" } }), layer({ "code-search": { engines: { mnemex: { command: "x" } } } })]).engineConfigured).toBe(true);
    expect(gateSettings([layer({ "code-search": { engine: "typo", engines: { fake: { command: "x" } } } })]).engineConfigured).toBe(false);
  });
});
