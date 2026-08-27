/**
 * server.call-timeout.test.ts — the per-engine call deadline, at the seam.
 *
 * `callMsFor` is the ONE place `EngineSpec.callTimeoutMs` becomes
 * `McpClientOptions.callMs`. Three tokens of code, and still worth its own file: a
 * deadline that silently reverts to the default is indistinguishable, from the outside,
 * from one that was never configured. That is precisely the shape of the defect this
 * feature exists to remove, so the mapping is asserted directly rather than inferred
 * from a run that happened not to time out.
 *
 * NOTHING HERE SPAWNS. The end-to-end proof — a real server, real settings on disk, a
 * real child that never answers, and the configured number coming back out in the
 * timeout note — is `server.e2e.test.ts`, "a timeout note quotes the CONFIGURED
 * deadline". This file covers the resolution itself, including the values that never
 * reach it because settings rejected them first.
 *
 * Run: bun test plugins/code-analysis/mcp/server.call-timeout.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  CALL_TIMEOUT_CEILING_MS,
  mergeSettingsLayers,
  type EngineSpec,
} from "./core/settings";
import { MCP_CLIENT_DEFAULTS } from "./transport/mcp-stdio-client";
import { callMsFor } from "./server";

/** The `engines.<id>` spec settings would produce for one raw block. */
function specFor(raw: unknown, id = "mnemex"): EngineSpec | undefined {
  return mergeSettingsLayers([{ engines: { [id]: raw } }]).settings.engines[id];
}

describe("callMsFor", () => {
  test("an engine with no callTimeoutMs gets the transport default — 30_000", () => {
    // The literal AND the constant. The constant is what makes this test track a change
    // to the default; the literal is what makes it fail loudly if someone "fixes" the
    // 20/24 bench timeout by raising the global instead of configuring the engine.
    expect(callMsFor({ command: "serena" })).toBe(MCP_CLIENT_DEFAULTS.callMs);
    expect(callMsFor({ command: "serena" })).toBe(30_000);
  });

  test("a configured value is passed through verbatim", () => {
    expect(callMsFor({ command: "mnemex", callTimeoutMs: 120_000 })).toBe(120_000);
    expect(callMsFor({ command: "mnemex", callTimeoutMs: 1 })).toBe(1);
    expect(callMsFor({ command: "mnemex", callTimeoutMs: CALL_TIMEOUT_CEILING_MS })).toBe(
      CALL_TIMEOUT_CEILING_MS,
    );
  });

  test("the ceiling sits below the default idle kill, so a deadline can actually fire", () => {
    // An idle window shorter than the deadline would let the idle timer reap the child
    // out from under a call that had not yet missed its deadline, and the caller would
    // read "was stopped after Nms idle" for what is really a timeout.
    expect(CALL_TIMEOUT_CEILING_MS).toBeLessThan(MCP_CLIENT_DEFAULTS.idleMs);
  });

  test("settings never hand it a value that would disable or invert the deadline", () => {
    // `callMsFor` uses `??`, so a 0 arriving here would be honoured as "no deadline at
    // all" — every call would hang forever and the transport would never kill the child.
    // The guarantee that it cannot arrive lives in `validateEngines`, and this asserts
    // the two halves agree rather than trusting the comment that says they do.
    for (const bad of [0, -1, 1.5, Number.NaN, "120000", null]) {
      const spec = specFor({ command: "mnemex", callTimeoutMs: bad });
      expect(spec).toBeDefined();
      expect(spec?.callTimeoutMs).toBeUndefined();
      expect(callMsFor(spec as EngineSpec)).toBe(MCP_CLIENT_DEFAULTS.callMs);
    }
  });

  test("a value settings accepted survives the round trip from a raw settings block", () => {
    const spec = specFor({ command: "mnemex", args: ["--mcp"], callTimeoutMs: 120_000 });
    expect(spec).toBeDefined();
    expect(callMsFor(spec as EngineSpec)).toBe(120_000);
  });
});
