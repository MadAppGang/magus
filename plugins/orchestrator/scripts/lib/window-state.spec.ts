import { describe, expect, test } from "bun:test";
import { parseArgs, envPrefix, buildLaunch, buildChildLine } from "./window";
import { MANAGER, CHILD, ROOT } from "../../tests/testdata";

const required = ["--name", "api-review", "--colour", "blue"];
describe("launch identity prefixes [R3.4; §4.4]", () => {
  test("[REQ-16; §4.4] TEST-501 prefixes default and custom launch in order, without changing an empty-env launch", () => {
    const spec = { name: "api-review", colour: "blue" as const };
    const env = [["ORCHESTRATOR_CLAIM", CHILD], ["ORCHESTRATOR_STATE_DIR", ROOT + "/state with space"]] as const;
    const prefix = "ORCHESTRATOR_CLAIM='" + CHILD + "' ORCHESTRATOR_STATE_DIR='" + ROOT + "/state with space' ";
    expect(envPrefix(env)).toBe(prefix);
    expect(buildLaunch({ ...spec, env })).toBe(prefix + buildLaunch(spec));
    expect(buildLaunch({ ...spec, env: [] })).toBe(buildLaunch(spec));
    expect(envPrefix(undefined)).toBe("");
    expect(envPrefix([])).toBe("");
    expect(buildLaunch({ ...spec, env, launch: "wt" })).toBe(prefix + "wt api-review blue");
    const child = buildChildLine({ ...spec, env, launch: "wt", dir: ROOT + "/other checkout" });
    expect(child).toBe("cd '" + ROOT + "/other checkout' && git pull --ff-only && " + prefix + "wt api-review blue");
  });

  test("[REQ-16; §4.4] TEST-501 a launched manager's inherited claim is never parsed as its custom launch", () => {
    for (const custom of [undefined, "wt"]) {
      const parsed = parseArgs([...required, "--print-line"], { ORCHESTRATOR_CLAIM: MANAGER, ORCHESTRATOR_LAUNCH: custom });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || parsed.args.mode !== "print-line") throw new Error("Expected print-line arguments");
      const line = buildLaunch({ ...parsed.args, env: [["ORCHESTRATOR_CLAIM", CHILD]] });
      expect(line.startsWith("ORCHESTRATOR_CLAIM='" + CHILD + "' ")).toBe(true);
      if (custom) expect(line).toBe("ORCHESTRATOR_CLAIM='" + CHILD + "' wt api-review blue");
      else {
        expect(line).toMatch(/claude -w ['"]?api-review/);
        expect(line).not.toContain(MANAGER);
      }
    }
  });

  test("[REQ-16; §4.4] TEST-501 quotes prefix apostrophes and rejects launch-command keys and unsafe values", () => {
    expect(envPrefix([["ORCHESTRATOR_NOTE", "a'b"]])).toBe("ORCHESTRATOR_NOTE='a'\\''b' ");
    for (const key of ["ORCHESTRATOR_LAUNCH", "HOME", "ORCHESTRATOR_bad", "ORCHESTRATOR_BAD1", "ORCHESTRATOR_X;bad"]) {
      expect(() => envPrefix([[key, "value"]])).toThrow();
    }
    for (const value of ["a\nb", "a\0b"]) expect(() => envPrefix([["ORCHESTRATOR_CLAIM", value]])).toThrow();
  });

  for (const id of ["#229", "229", "example/product#229", "DEMO-7", "A".repeat(80)]) {
    test(`[REQ-16; §4.4] TEST-501 accepts ticket ${id} in both start and print-line modes`, () => {
      for (const mode of [[], ["--print-line"]]) {
        const parsed = parseArgs([...required, ...mode, "--ticket", id, "--ticket-url", "https://example.test/issue/7"], {});
        expect(parsed).toMatchObject({ ok: true, args: { ticket: id, ticketUrl: "https://example.test/issue/7" } });
      }
    });
  }
  for (const [flag, value] of [
    ["--ticket", ""], ["--ticket", "A".repeat(81)], ["--ticket", ".escape"],
    ["--ticket", "DEMO 7"], ["--ticket-url", "http://example.test"],
    ["--ticket-url", "https://example.test/a b"], ["--ticket-url", "https://example.test/a'b"],
    ["--ticket-url", "https://example.test/a\\b"],
  ]) {
    test(`[REQ-16; §4.4] TEST-501 rejects unsafe ${flag} ${JSON.stringify(value)}`, () => {
      expect(parseArgs([...required, flag!, value!], {}).ok).toBe(false);
      expect(parseArgs([...required, "--print-line", flag!, value!], {}).ok).toBe(false);
    });
  }
});
