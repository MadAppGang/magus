import { expect, test } from "bun:test";
// R12.6 names the file `server.ts`; the server module is mcp/server.ts (no grep/server.ts exists).
import { makeGateReader } from "../mcp/server";
import { GREP_DECODE_BUDGET_BYTES, GREP_ENGINE_SLOTS, SERVER_DEADLINE_MS } from "../mcp/grep/service";

test("R12.6 P6 public deadline, concurrency and raw-byte budget constants", () => {
  expect({ deadline: SERVER_DEADLINE_MS, slots: GREP_ENGINE_SLOTS, decodeBytes: GREP_DECODE_BUDGET_BYTES })
    .toEqual({ deadline: 1400, slots: 2, decodeBytes: 8 * 1024 * 1024 });
});
test("R12.6 P6 makeGateReader stats every layer, reads only on signature changes", async () => {
  const paths = ["user", "project", "local"];
  const texts = new Map<string, string | undefined>([
    ["user", JSON.stringify({ "code-search": { engine: "mnemex", engines: { mnemex: { command: "mnemex" } } } })],
    ["project", JSON.stringify({ "code-search": { grep: { route: true } } })],
    ["local", undefined],
  ]);
  const signatures = new Map<string, string>([["user", "u1"], ["project", "p1"], ["local", "missing"]]);
  const stats: string[] = [], reads: string[] = [];
  const gate = makeGateReader({
    paths, platform: "darwin", env: {}, engineConfigured: true,
    stat: async (path) => { stats.push(path); return signatures.get(path)!; },
    read: async (path) => { reads.push(path); return texts.get(path); },
  });
  expect(await gate()).toBeUndefined();
  expect(stats).toEqual(paths);
  expect(reads).toEqual(paths);
  expect(await gate()).toBeUndefined();
  expect(stats).toEqual([...paths, ...paths]);
  expect(reads).toEqual(paths);

  texts.set("local", JSON.stringify({ "code-search": { grep: { route: false } } }));
  signatures.set("local", "l1");
  expect(await gate()).toBe("route-off");
  expect(stats).toEqual([...paths, ...paths, ...paths]);
  expect(reads).toEqual([...paths, ...paths]);

  texts.set("local", JSON.stringify({ "code-search": { grep: { route: true } }, env: { CODE_SEARCH_MERGE: "0" } }));
  signatures.set("local", "l2");
  expect(await gate()).toBe("kill-switch");
  expect(reads).toEqual([...paths, ...paths, ...paths]);
});
test("R12.6 P6 gate reader combines process kill switch with settings", async () => {
  const gate = makeGateReader({
    paths: ["user", "project", "local"], platform: "darwin", engineConfigured: true,
    env: { CODE_SEARCH_MERGE: "0" }, stat: () => "missing", read: () => undefined,
  });
  expect(await gate()).toBe("kill-switch");
});
