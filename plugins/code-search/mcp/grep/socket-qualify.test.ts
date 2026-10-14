/**
 * socket-qualify.test.ts — the one rule every client and the server use to trust a
 * session socket (review round 1, Codex C6).
 *
 * The directory must be a real directory (never a symlink), owned by this uid, mode 0700;
 * the socket must be a socket owned by this uid. Anything else is a silent no-op: another
 * OS user who pre-creates `/tmp/code-search-<uid>/<pid>.sock` must not receive a request.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { sessionSocket } from "./socket";

const uid = process.getuid?.() ?? 0;
const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((resolve) => s.close(() => resolve()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function base(): string {
  const root = realpathSync(mkdtempSync("/tmp/cs-qual-"));
  roots.push(root);
  return root;
}

async function listen(path: string): Promise<void> {
  const s = createServer();
  servers.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once("error", reject);
    s.listen(path, () => resolve());
  });
}

/** `<tmp>/code-search-<uid>/<ppid>.sock`, a real listening socket, dir 0700. */
async function good(ppid = 4242): Promise<{ tmp: string; dir: string; sock: string }> {
  const tmp = base();
  const dir = join(tmp, `code-search-${uid}`);
  mkdirSync(dir, { mode: 0o700 });
  chmodSync(dir, 0o700);
  const sock = join(dir, `${ppid}.sock`);
  await listen(sock);
  return { tmp, dir, sock };
}

describe("sessionSocket", () => {
  test("a real 0700 dir and a socket, both owned by this uid: the socket path", async () => {
    const g = await good();
    expect(sessionSocket({ TMPDIR: g.tmp }, uid, 4242)).toBe(g.sock);
  });

  test("no base, a relative base, or no socket for this ppid: undefined", async () => {
    const g = await good();
    expect(sessionSocket({}, uid, 4242)).toBeUndefined();
    expect(sessionSocket({ TMPDIR: "relative" }, uid, 4242)).toBeUndefined();
    expect(sessionSocket({ TMPDIR: g.tmp }, uid, 4243)).toBeUndefined();
  });

  test("a dir that is not 0700 (0755, 0750, 0711): undefined", async () => {
    const g = await good();
    for (const mode of [0o755, 0o750, 0o711]) {
      chmodSync(g.dir, mode);
      expect(sessionSocket({ TMPDIR: g.tmp }, uid, 4242)).toBeUndefined();
    }
    chmodSync(g.dir, 0o700);
    expect(sessionSocket({ TMPDIR: g.tmp }, uid, 4242)).toBe(g.sock);
  });

  test("a symlinked dir, even to a good one: undefined", async () => {
    const g = await good();
    const other = base();
    symlinkSync(g.dir, join(other, `code-search-${uid}`));
    expect(sessionSocket({ TMPDIR: other }, uid, 4242)).toBeUndefined();
  });

  test("a regular file, or a symlink to a socket, at the socket path: undefined", async () => {
    const tmp = base();
    const dir = join(tmp, `code-search-${uid}`);
    mkdirSync(dir, { mode: 0o700 });
    writeFileSync(join(dir, "4242.sock"), "not a socket");
    expect(sessionSocket({ TMPDIR: tmp }, uid, 4242)).toBeUndefined();
    const g = await good(5);
    symlinkSync(g.sock, join(dir, "4243.sock"));
    expect(sessionSocket({ TMPDIR: tmp }, uid, 4243)).toBeUndefined();
  });

  test("owned by another uid: undefined (simulated by asking for a different uid)", async () => {
    const g = await good();
    // The dir is code-search-<uid>; asking as uid+1 names a dir that does not exist, so
    // build the foreign case directly: the right name, owned by someone else.
    const foreign = uid + 1;
    const fdir = join(g.tmp, `code-search-${foreign}`);
    mkdirSync(fdir, { mode: 0o700 });
    await listen(join(fdir, "4242.sock"));
    expect(sessionSocket({ TMPDIR: g.tmp }, foreign, 4242)).toBeUndefined();
  });
});
