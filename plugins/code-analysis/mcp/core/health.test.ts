/**
 * Tests for the health assessors. Fixtures only — nothing here spawns a process or
 * reads a file, which is exactly why the states that break silently are testable.
 *
 * Run: bun test plugins/code-analysis/mcp/core/health.test.ts
 */

import { describe, expect, test } from "bun:test";
import { CAPABILITIES } from "./capabilities";
import { assessRipgrep, emptyHealth, summariseEngineHealth, type RipgrepEvidence } from "./health";
import type { ProbeResult } from "./registry";

const SHIM_PATH = "/fixture/home/.local/bin/rg";

function evidence(overrides: Partial<RipgrepEvidence> = {}): RipgrepEvidence {
  return {
    doctorJson: { ripgrepStatus: { working: true, mode: "system", systemPath: SHIM_PATH } },
    shimPath: SHIM_PATH,
    shimHeader: "#!/bin/sh\n# OWNER=code-analysis VERSION=6.0.0\n",
    commandVRg: SHIM_PATH,
    typeRg: `rg is ${SHIM_PATH}`,
    settingPrefersSystem: true,
    repairedThisSession: false,
    ...overrides,
  };
}

function codes(notes: readonly { code: string }[]): string[] {
  return notes.map((note) => note.code);
}

describe("assessRipgrep — routing comes from the host, never from the setting", () => {
  test("mode and working are read out of ripgrepStatus", () => {
    const { ripgrep } = assessRipgrep(evidence());
    expect(ripgrep).toEqual({ working: true, mode: "system", systemPath: SHIM_PATH });
  });

  test("settingPrefersSystem never decides mode", () => {
    // The host treats 0|false|no|off as a PREFERENCE and silently falls through to its
    // embedded copy when the PATH lookup finds nothing. Any check that infers routing
    // from the setting reports the opposite of what is happening.
    const { ripgrep, shim } = assessRipgrep(
      evidence({
        doctorJson: { ripgrepStatus: { working: true, mode: "embedded" } },
        settingPrefersSystem: true,
      }),
    );
    expect(ripgrep.mode).toBe("embedded");
    expect(shim.settingPrefersSystem).toBe(true);
  });

  test("an unrecognisable doctor payload degrades rather than throwing", () => {
    expect(assessRipgrep(evidence({ doctorJson: null })).ripgrep).toEqual({
      working: false,
      mode: "unknown",
    });
    expect(assessRipgrep(evidence({ doctorJson: { ripgrepStatus: 7 } })).ripgrep.mode).toBe(
      "unknown",
    );
  });
});

describe("assessRipgrep — the states that break silently", () => {
  test("the setting prefers a system rg and the shim is not there", () => {
    const { shim, notes } = assessRipgrep(evidence({ shimHeader: undefined, commandVRg: "" }));
    expect(shim.present).toBe(false);
    expect(shim.owner).toBe("none");
    expect(codes(notes)).toContain("grep_routing");
    const note = notes[0];
    expect(note?.message).toContain(SHIM_PATH);
    expect(note?.message).toContain("embedded");
    expect(note?.remedy).toBe("/code-analysis:setup");
  });

  test("a foreign owner marker is refused, not clobbered", () => {
    const { shim, notes } = assessRipgrep(
      evidence({ shimHeader: "#!/bin/sh\n# OWNER=somebody-else VERSION=1.0\n" }),
    );
    expect(shim.owner).toBe("foreign");
    expect(notes.some((n) => n.message.includes("will not be overwritten"))).toBe(true);
  });

  test("mnemex's own shim is recognised as neither ours nor foreign", () => {
    expect(assessRipgrep(evidence({ shimHeader: "# OWNER=mnemex VERSION=0.31.2" })).shim).toMatchObject(
      { owner: "mnemex", version: "0.31.2" },
    );
  });

  test("PATH-position shadowing is reported with what actually won", () => {
    const { shim, notes } = assessRipgrep(evidence({ commandVRg: "/fixture/elsewhere/bin/rg\n" }));
    expect(shim.shadowedBy).toBe("/fixture/elsewhere/bin/rg");
    expect(notes.some((n) => n.message.includes("/fixture/elsewhere/bin/rg"))).toBe(true);
  });

  test("a Bash shell function beats PATH, and is reported", () => {
    const { shim, notes } = assessRipgrep(
      evidence({ typeRg: "rg is a shell function from /fixture/shell-snapshot.sh" }),
    );
    expect(shim.functionShadowed).toBe(true);
    expect(notes.some((n) => n.message.includes("shell function"))).toBe(true);
  });

  test("a repair this session is not live until a restart, and says so", () => {
    // USE_BUILTIN_RIPGREP is read at host startup, so a mid-session write does nothing
    // and the user would otherwise believe routing is live when it is not.
    const { shim, notes } = assessRipgrep(evidence({ repairedThisSession: true }));
    expect(shim.restartRequired).toBe(true);
    expect(notes.some((n) => n.message.includes("restart"))).toBe(true);
  });

  test("a healthy, owned, unshadowed shim produces no notes at all", () => {
    expect(assessRipgrep(evidence()).notes).toEqual([]);
  });
});

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
