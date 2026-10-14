/**
 * Tests for the engine health assessors. Fixtures only — nothing here spawns a process or
 * reads a file.
 *
 * Run: bun test plugins/code-search/mcp/core/health.test.ts
 */

import { describe, expect, test } from "bun:test";
import { CAPABILITIES } from "./capabilities";
import { emptyHealth, summariseEngineHealth } from "./health";
import type { ProbeResult } from "./registry";

describe("summariseEngineHealth", () => {
  test("a failed probe is one error note carrying the remedy", () => {
    const probe: ProbeResult = {
      ok: false,
      reason: "mnemex exited 127 on spawn",
      remedy: "bun install -g mnemex",
    };
    expect(summariseEngineHealth(probe)).toEqual([
      {
        level: "error",
        code: "backend_unavailable",
        message: "mnemex exited 127 on spawn",
        remedy: "bun install -g mnemex",
      },
    ]);
  });

  test("retryable is degraded/backend_unavailable, permanent is error/capability_unsupported", () => {
    const health = emptyHealth("mnemex", "index holds 0 files", "mnemex index");
    health.capabilities.findImplementations = {
      ready: false,
      reason: "this language server has no find_implementations",
      retryable: false,
    };
    const notes = summariseEngineHealth({ ok: true, health });

    const retryable = notes.find((n) => n.message.includes("generalSearch"));
    expect(retryable?.level).toBe("degraded");
    expect(retryable?.code).toBe("backend_unavailable");
    expect(retryable?.remedy).toBe("mnemex index");

    const permanent = notes.find((n) => n.message.includes("findImplementations"));
    expect(permanent?.level).toBe("error");
    // Conflating these makes a permanent absence look transient and an outage look
    // permanent, which is the distinction the code exists to carry.
    expect(permanent?.code).toBe("capability_unsupported");
  });

  test("a fully ready engine produces no notes", () => {
    const health = emptyHealth("enginea", "unused");
    for (const capability of CAPABILITIES) health.capabilities[capability] = { ready: true };
    expect(summariseEngineHealth({ ok: true, health })).toEqual([]);
  });
});

describe("emptyHealth", () => {
  test("every capability is unready and RETRYABLE", () => {
    const health = emptyHealth("mnemex", "could not probe", "mnemex index");
    expect(Object.keys(health.capabilities).sort()).toEqual([...CAPABILITIES].sort());
    for (const capability of CAPABILITIES) {
      // retryable deliberately: a failed probe must never shrink the tool list, or a
      // transient outage becomes a permanent absence and the agent stops asking.
      expect(health.capabilities[capability]).toEqual({
        ready: false,
        reason: "could not probe",
        remedy: "mnemex index",
        retryable: true,
      });
    }
  });

  test("omits remedy when there is none rather than inventing one", () => {
    const health = emptyHealth("engineb", "no graph.json");
    expect(health.capabilities.generalSearch).toEqual({
      ready: false,
      reason: "no graph.json",
      retryable: true,
    });
  });
});
