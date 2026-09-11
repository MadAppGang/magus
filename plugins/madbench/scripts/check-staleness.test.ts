/**
 * The fail-closed surface of the staleness checker.
 *
 * `parseVersion` is the one function whose wrong answer turns a stale skill into a green
 * check, so every shape `madbench version` has been seen to print — and the ones it must
 * never be trusted on — is pinned here. The verdict tests are the negative controls: each
 * rule is shown firing, and the same input minus the defect is shown clean.
 */
import { describe, expect, test } from "bun:test";
import { absentReport, compareSemver, declaresImage, optValue, parseVersion, verdict, type Mirrors, type Probe } from "./check-staleness.ts";

const MIRRORS: Mirrors = {
  madbenchVersion: "0.33.0",
  verifiedAt: "2026-09-10",
  versionSensitive: ["skills/madbench-evals/schema.md"],
  stable: ["skills/madbench-evals/debugging.md"],
};
const ok = (file: string): Probe => ({ file, list: { code: 0, out: "Bench: x\n" }, preflight: { code: 0, out: "preflight ok" } });

describe("parseVersion — fails closed", () => {
  test("the released shape, exactly as 0.33.0 prints it", () => {
    expect(parseVersion("madbench 0.33.0\n")).toBe("0.33.0");
  });
  test("a source build answers dev and is refused", () => {
    expect(parseVersion("madbench dev\n")).toBeNull();
  });
  test("an update banner after the version line is refused, never skipped over", () => {
    expect(parseVersion("madbench 0.33.0\n↑ madbench v0.34.0 is available — run: madbench update\n")).toBeNull();
  });
  test("a prerelease tag is refused", () => {
    expect(parseVersion("madbench 0.34.0-rc1")).toBeNull();
  });
  test("a v prefix, empty output and the ASCII banner are all refused", () => {
    expect(parseVersion("madbench v0.33.0")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("███ MADBENCH ███ 0.33.0")).toBeNull();
  });
});

describe("compareSemver", () => {
  test("orders numerically, not lexically", () => {
    expect(compareSemver("0.9.0", "0.33.0")).toBe(-1);
    expect(compareSemver("0.33.0", "0.33.0")).toBe(0);
    expect(compareSemver("1.0.0", "0.99.9")).toBe(1);
  });
});

describe("declaresImage", () => {
  test("true for a Scenario carrying image:, false otherwise, false on unparseable YAML", () => {
    expect(declaresImage("scenarios:\n  - name: s\n    image: generated:x.png\n")).toBe(true);
    expect(declaresImage("scenarios:\n  - name: s\n    prompt: hi\n")).toBe(false);
    expect(declaresImage("scenarios: [\n")).toBe(false);
  });
});

describe("verdict — three-valued, and the content probe decides", () => {
  test("current version and every example loading is exit 0", () => {
    expect(verdict({ mirrors: MIRRORS, versionOut: "madbench 0.33.0", probes: [ok("a")] }).exit).toBe(0);
  });
  test("a newer installed release under --strict is exit 1 and names the version-sensitive files", () => {
    const r = verdict({ mirrors: MIRRORS, versionOut: "madbench 0.34.0", probes: [ok("a")], strict: true });
    expect(r.exit).toBe(1);
    expect(r.lines.join("\n")).toContain("skills/madbench-evals/schema.md");
  });
  test("the same drift WITHOUT --strict is advisory: exit 0, STALE still printed", () => {
    const r = verdict({ mirrors: MIRRORS, versionOut: "madbench 0.34.0", probes: [ok("a")] });
    expect(r.exit).toBe(0);
    expect(r.lines.join("\n")).toContain("STALE");
    expect(r.lines.join("\n")).toContain("advisory only");
  });
  test("a refused example is exit 1 in BOTH modes — the content probe is the gate", () => {
    const refused = { file: "b", list: { code: 1, out: "Error: nope" }, preflight: null };
    expect(verdict({ mirrors: MIRRORS, versionOut: "madbench 0.33.0", probes: [refused] }).exit).toBe(1);
    expect(verdict({ mirrors: MIRRORS, versionOut: "madbench 0.33.0", probes: [refused], strict: true }).exit).toBe(1);
  });
  test("a process that never started is exit 2, not exit 1", () => {
    const r = verdict({ mirrors: MIRRORS, versionOut: "madbench 0.33.0", probes: [{ file: "b", list: { code: null, out: "" }, preflight: null }] });
    expect(r.exit).toBe(2);
    expect(r.lines.join("\n")).toContain("COULD NOT MEASURE");
  });
  test("unmeasurable outranks a refusal", () => {
    const r = verdict({
      mirrors: MIRRORS,
      versionOut: "madbench 0.33.0",
      probes: [
        { file: "b", list: { code: 1, out: "Error: nope" }, preflight: null },
        { file: "c", list: { code: null, out: "" }, preflight: null },
      ],
    });
    expect(r.exit).toBe(2);
  });
  test("a matching version with a refused bench is exit 1 — the version line is never the verdict", () => {
    const r = verdict({
      mirrors: MIRRORS,
      versionOut: "madbench 0.33.0",
      probes: [{ file: "b/madbench.yaml", list: { code: 1, out: "Error: field derivedMetrics not found in type madbench.BenchSpec" }, preflight: null }],
    });
    expect(r.exit).toBe(1);
    expect(r.lines.join("\n")).toContain("derivedMetrics");
    expect(r.lines.join("\n")).toContain("b/madbench.yaml");
  });
  test("a preflight refusal is exit 1 even when list passed", () => {
    const r = verdict({ mirrors: MIRRORS, versionOut: "madbench 0.33.0", probes: [{ file: "c", list: { code: 0, out: "" }, preflight: { code: 1, out: 'unknown check type "environment:nonsense"' } }] });
    expect(r.exit).toBe(1);
    expect(r.lines.join("\n")).toContain("environment:nonsense");
  });
  test("an unparseable version is exit 2, whatever the examples say", () => {
    expect(verdict({ mirrors: MIRRORS, versionOut: "madbench dev", probes: [ok("a")] }).exit).toBe(2);
  });
  test("no examples is exit 2 — nothing was measured", () => {
    expect(verdict({ mirrors: MIRRORS, versionOut: "madbench 0.33.0", probes: [] }).exit).toBe(2);
  });
});

describe("optValue — a flag that appears to take effect must take effect", () => {
  test("returns the value that follows the flag, and undefined when the flag is absent", () => {
    expect(optValue(["--mirrors", "m.json"], "--mirrors")).toBe("m.json");
    expect(optValue(["--strict"], "--mirrors")).toBeUndefined();
  });
  test("a flag as the value is refused, not silently consumed", () => {
    expect(() => optValue(["--mirrors", "--strict"], "--mirrors")).toThrow("got the flag --strict");
  });
  test("a trailing flag with no value is refused, not silently defaulted", () => {
    expect(() => optValue(["--strict", "--mirrors"], "--mirrors")).toThrow("needs a value");
  });
});

describe("absentReport", () => {
  test("advisory is one line and exit 0; strict is exit 2", () => {
    expect(absentReport(false)).toMatchObject({ exit: 0 });
    expect(absentReport(false).lines).toHaveLength(1);
    expect(absentReport(true).exit).toBe(2);
  });
});
