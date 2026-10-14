import { afterEach, describe, expect, test } from "bun:test";
import { connect } from "node:net";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { GrepRequest } from "./service";
import { chooseSocketDir, parseBody, startGrepSocket } from "./socket";

const encoder = new TextEncoder();
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

function nul(...fields: string[]): Uint8Array {
  return bytes(fields.map((f) => `${f}\0`).join(""));
}

describe("socket selection", () => {
  test("prefers an absolute TMPDIR, trims one slash, falls back to XDG_RUNTIME_DIR; dir is code-search-<uid>", () => {
    expect(chooseSocketDir({ TMPDIR: "/run/a/", XDG_RUNTIME_DIR: "/run/b" }, 7, 9)).toEqual({
      dir: "/run/a/code-search-7", sock: "/run/a/code-search-7/9.sock",
    });
    expect(chooseSocketDir({ TMPDIR: "relative", XDG_RUNTIME_DIR: "/run/b" }, 7, 9)).toEqual({
      dir: "/run/b/code-search-7", sock: "/run/b/code-search-7/9.sock",
    });
  });

  test("measures the socket path limit in UTF-8 bytes", () => {
    let fitting: string | undefined;
    let tooLong: string | undefined;
    for (let n = 1; n < 100; n++) {
      const base = `/${"é".repeat(n)}`;
      const result = chooseSocketDir({ TMPDIR: base }, 7, 9);
      if (result) fitting = base;
      else if (fitting) { tooLong = base; break; }
    }
    expect(fitting).toBeDefined();
    expect(tooLong).toBeDefined();
    expect(Buffer.byteLength(chooseSocketDir({ TMPDIR: fitting! }, 7, 9)!.sock)).toBeLessThanOrEqual(100);
    expect(chooseSocketDir({ TMPDIR: tooLong! }, 7, 9)).toBeUndefined();
  });
});

describe("request body parser (P4)", () => {
  test("G: the exact wrapper layout, argv by argc", () => {
    expect(parseBody(nul("CSM1", "G", "123", "456", "/w", "3", "-rn", "fetch User", "src"))).toEqual({
      kind: "merge", ppid: 123, callerPid: 456, cwd: "/w", input: { kind: "bash", argv: ["-rn", "fetch User", "src"] },
    });
    expect(parseBody(nul("CSM1", "G", "1", "2", "/w", "0"))).toEqual({
      kind: "merge", ppid: 1, callerPid: 2, cwd: "/w", input: { kind: "bash", argv: [] },
    });
  });

  test("T: one JSON field", () => {
    expect(parseBody(nul("CSM1", "T", "123", "456", "/w", JSON.stringify({ pattern: "x", offset: 5 })))).toEqual({
      kind: "merge", ppid: 123, callerPid: 456, cwd: "/w", input: { kind: "tool", json: { pattern: "x", offset: 5 } },
    });
  });

  test("P, and every malformed shape", () => {
    expect(parseBody(nul("CSM1", "P", "123"))).toEqual({ kind: "ping", ppid: 123 });
    for (const body of [
      nul("CSRG2", "P", "123"), nul("CSM1", "P", "-1"), nul("CSM1", "P", "x"), nul("CSM1", "P", "123", "extra"),
      nul("CSM1", "P", "0123"),
      nul("CSM1", "G", "1", "2", "/w", "2", "only-one"),
      nul("CSM1", "G", "1", "2", "/w", "0", "trailing"),
      nul("CSM1", "G", "1", "2", "/w"),
      nul("CSM1", "T", "1", "2", "/w", "{not json"),
      nul("CSM1", "T", "1", "2", "/w", "{}", "extra"),
      nul("CSM1", "Q", "1", "2", "/w", "0"),
      bytes("CSM1\x00P\x00123"), // no final NUL
      new Uint8Array([0x43, 0x53, 0x4d, 0x31, 0, 0x50, 0, 0xff, 0]),
    ]) expect(parseBody(body)).toBeUndefined();
  });
});

interface RawResponse { status: number; headers: Record<string, string>; body: Buffer }

async function rawRequest(sock: string, path: string, body: Uint8Array, splitAt?: number): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(sock);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("Unix HTTP request timed out")); }, 2_000);
    const chunks: Buffer[] = [];
    socket.on("error", (error) => { clearTimeout(timer); reject(error); });
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      const all = Buffer.concat(chunks);
      const separator = all.indexOf("\r\n\r\n");
      if (separator < 0) return;
      const head = all.subarray(0, separator).toString("latin1");
      const headers = Object.fromEntries(head.split("\r\n").slice(1).map((line) => {
        const colon = line.indexOf(":");
        return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
      }));
      const length = Number(headers["content-length"] ?? 0);
      const receivedBody = all.subarray(separator + 4);
      if (receivedBody.length < length) return;
      clearTimeout(timer);
      socket.destroy();
      resolve({ status: Number(head.split(" ")[1]), headers, body: receivedBody.subarray(0, length) });
    });
    socket.on("connect", () => {
      const header = Buffer.from(`POST ${path} HTTP/1.1\r\nHost: code-search\r\nContent-Length: ${body.byteLength}\r\nConnection: keep-alive\r\n\r\n`);
      const request = Buffer.concat([header, body]);
      if (splitAt === undefined) socket.write(request);
      else {
        socket.write(request.subarray(0, splitAt));
        setTimeout(() => socket.write(request.subarray(splitAt)), 10);
      }
    });
  });
}

async function waitForBound(server: ReturnType<typeof startGrepSocket>): Promise<string> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const bound = server.bound();
    if (bound) return bound;
    await delay(5);
  }
  throw new Error("merge socket did not bind");
}

async function stop(server: ReturnType<typeof startGrepSocket>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("merge socket stop timed out")), 2_000);
    server.stop().then(
      () => { clearTimeout(timer); resolve(); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function start(root: string, handled: GrepRequest[], ppid: number, payload = bytes("--- code-search: x\n")) {
  return startGrepSocket({
    env: { TMPDIR: root },
    uid: process.getuid?.() ?? 501,
    ppid: () => ppid,
    startedAtMs: 123456,
    service: {
      async handle(req: GrepRequest) {
        handled.push(req);
        return { payload, reason: "appended" as const };
      },
    },
    log: () => {},
  });
}

test("real socket: /merge frames G and T, /ping answers CSMP for any ppid, wrong routes decline", async () => {
  const root = mkdtempSync("/tmp/cs-sock-");
  roots.push(root);
  const uid = process.getuid?.() ?? 501;
  const ppid = process.pid;
  const handled: GrepRequest[] = [];
  const payload = bytes("semantic-extra");
  const server = start(root, handled, ppid, payload);
  try {
    const sock = await waitForBound(server);
    expect(sock).toBe(join(root, `code-search-${uid}`, `${ppid}.sock`));
    expect(statSync(join(root, `code-search-${uid}`)).mode & 0o777).toBe(0o700);

    const g = await rawRequest(sock, "/merge", nul("CSM1", "G", String(ppid), "77", root, "2", "-rn", "x"), 25);
    expect(g.status).toBe(200);
    expect(g.headers.connection).toBe("close");
    expect(g.body).toEqual(Buffer.concat([Buffer.from("CSM1 14\n"), Buffer.from(payload)]));
    expect(handled[0]).toMatchObject({ ppid, callerPid: 77, cwd: root, input: { kind: "bash", argv: ["-rn", "x"] } });
    expect(typeof handled[0]?.receivedAt).toBe("number");

    const t = await rawRequest(sock, "/merge", nul("CSM1", "T", String(ppid), "78", "/w", JSON.stringify({ pattern: "x" })));
    expect(t.body.toString()).toBe("CSM1 14\nsemantic-extra");
    expect(handled[1]).toMatchObject({ callerPid: 78, cwd: "/w", input: { kind: "tool", json: { pattern: "x" } } });

    const ping = await rawRequest(sock, "/ping", nul("CSM1", "P", "4243"));
    expect(ping.body.toString()).toMatch(new RegExp(`^CSMP ${ppid} 123456 ${process.pid}\\n$`));

    expect((await rawRequest(sock, "/grep", nul("CSM1", "G", String(ppid), "77", root, "0"))).body.length).toBe(0);
    expect((await rawRequest(sock, "/merge", nul("CSM1", "P", String(ppid)))).body.toString()).toBe("CSM1 0\n");
    expect((await rawRequest(sock, "/merge", bytes("garbage"))).body.toString()).toBe("CSM1 0\n");
    expect(handled).toHaveLength(2);
  } finally {
    await stop(server);
  }
  expect(existsSync(join(root, `code-search-${uid}`, `${ppid}.sock`))).toBe(false);
}, 10_000);

test("an existing uid-owned dir is chmod'ed to 0700; a symlinked dir is refused", async () => {
  const uid = process.getuid?.() ?? 501;
  const loose = mkdtempSync("/tmp/cs-sock-");
  roots.push(loose);
  mkdirSync(join(loose, `code-search-${uid}`), { mode: 0o755 });
  chmodSync(join(loose, `code-search-${uid}`), 0o755);
  const a = start(loose, [], process.pid);
  try {
    await waitForBound(a);
    expect(statSync(join(loose, `code-search-${uid}`)).mode & 0o777).toBe(0o700);
  } finally {
    await stop(a);
  }

  const linked = mkdtempSync("/tmp/cs-sock-");
  roots.push(linked);
  const target = mkdtempSync("/tmp/cs-sock-target-");
  roots.push(target);
  symlinkSync(target, join(linked, `code-search-${uid}`));
  const logs: string[] = [];
  const b = startGrepSocket({
    env: { TMPDIR: linked }, uid, ppid: () => process.pid, startedAtMs: 1,
    service: { handle: async () => ({ payload: new Uint8Array(), reason: "no_extras" as const }) },
    log: (line) => logs.push(line),
  });
  try {
    await delay(100);
    expect(b.bound()).toBeUndefined();
    expect(logs.join("\n")).toContain("dir unusable");
  } finally {
    await stop(b);
  }
}, 10_000);

test("the sweep removes .req/.out of a dead caller and keeps a live one's", async () => {
  const root = mkdtempSync("/tmp/cs-sock-");
  roots.push(root);
  const uid = process.getuid?.() ?? 501;
  const dir = join(root, `code-search-${uid}`);
  mkdirSync(dir, { mode: 0o700 });
  // A pid far above any live one on a test host reads ESRCH.
  const deadPid = 99_999_999;
  const live = process.pid;
  const files = [
    `${live}.${deadPid}.1.req`, `${live}.${deadPid}.1.out`, `${deadPid}.${live}.2.req`,
    `${live}.${live}.3.req`, `${live}.${live}.3.out`, `${deadPid}.sock`, `${live}.${live}.4.txt`,
  ];
  for (const name of files) writeFileSync(join(dir, name), "");
  const server = start(root, [], process.pid);
  try {
    await waitForBound(server);
    expect(files.filter((name) => existsSync(join(dir, name)))).toEqual([
      `${live}.${live}.3.req`, `${live}.${live}.3.out`, `${live}.${live}.4.txt`,
    ]);
  } finally {
    await stop(server);
  }
}, 10_000);
