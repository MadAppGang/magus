/**
 * server.merge-gate.test.ts — the per-request merge gate (D12), on a real temp tree.
 *
 * The gate re-stats the three settings files on every request and re-reads them only
 * when one changed, appeared or vanished. Turning the merge off with `grep.route: false`
 * or `env.CODE_SEARCH_MERGE: "0"` must take effect at the very next request, and turning
 * it on again likewise, with no server restart.
 *
 * Run: bun test plugins/code-search/mcp/server.merge-gate.test.ts
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { settingsLayerPaths } from "./core/settings";
import { makeGateReader } from "./server";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tree() {
  const root = mkdtempSync("/tmp/cs-gate-");
  roots.push(root);
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(project, ".claude"), { recursive: true });
  const [user, shared, local] = settingsLayerPaths(home, project) as [string, string, string];
  return { user, shared, local, paths: [user, shared, local] };
}

const write = (path: string, value: unknown): void => writeFileSync(path, JSON.stringify(value));

describe("makeGateReader", () => {
  test("open with no settings; each switch closes at the next call and reopens", async () => {
    const t = tree();
    const gate = makeGateReader({ paths: t.paths, platform: "darwin", env: {}, engineConfigured: true });
    expect(await gate()).toBeUndefined();

    write(t.local, { "code-search": { grep: { route: false } } });
    expect(await gate()).toBe("route-off");
    unlinkSync(t.local);
    expect(await gate()).toBeUndefined();

    write(t.user, { env: { CODE_SEARCH_MERGE: "0" } });
    expect(await gate()).toBe("kill-switch");
    // A later layer's env wins per key.
    write(t.shared, { env: { CODE_SEARCH_MERGE: "1" } });
    expect(await gate()).toBeUndefined();
  });

  test("the process environment's 0 closes whatever settings say", async () => {
    const t = tree();
    write(t.shared, { env: { CODE_SEARCH_MERGE: "1" } });
    const gate = makeGateReader({ paths: t.paths, platform: "darwin", env: { CODE_SEARCH_MERGE: "0" }, engineConfigured: true });
    expect(await gate()).toBe("kill-switch");
  });

  test("re-reads only when a signature changes", async () => {
    const reads: string[] = [];
    let version = "1";
    const gate = makeGateReader({
      paths: ["/a", "/b"],
      platform: "linux",
      env: {},
      engineConfigured: true,
      stat: (path) => (path === "/a" ? version : "absent"),
      read: (path) => {
        reads.push(path);
        return path === "/a" ? JSON.stringify({ "code-search": { grep: { route: version === "1" } } }) : undefined;
      },
    });
    expect(await gate()).toBeUndefined();
    expect(await gate()).toBeUndefined();
    expect(reads).toEqual(["/a", "/b"]);
    version = "2";
    expect(await gate()).toBe("route-off");
    expect(reads).toEqual(["/a", "/b", "/a", "/b"]);
  });

  // Review round 5, Codex HIGH: the gate ran synchronous statSync/readFileSync on the
  // event loop for every request, ahead of the request's deadline. It now answers through
  // a promise, with injected (or default) asynchronous stat and read.
  test("asynchronous: answers through a promise, and awaits an asynchronous stat and read", async () => {
    const answer = makeGateReader({
      paths: ["/a"],
      platform: "linux",
      env: {},
      engineConfigured: true,
      stat: async () => "1",
      read: async () => JSON.stringify({ "code-search": { grep: { route: false } } }),
    })();
    expect(answer).toBeInstanceOf(Promise);
    expect(await answer).toBe("route-off");
  });

  test("win32 and a missing engine close it", async () => {
    expect(await makeGateReader({ paths: [], platform: "win32", env: {}, engineConfigured: true })()).toBe("win32");
    expect(await makeGateReader({ paths: [], platform: "darwin", env: {}, engineConfigured: false })()).toBe("no-engine");
  });
});
