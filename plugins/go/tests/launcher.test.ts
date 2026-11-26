import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { alive, dash, inLaunch, until } from "./process-harness.ts";
import { frame } from "./wire.ts";

const request = frame({ jsonrpc: "2.0", id: 1, method: "initialize" });

test.each(["missing", "unrunnable", "failed"] as const)(
  "REQ-8 %s Bun check execs plain, preserves stdin and returns the server's code",
  kind => inLaunch(async lab => {
    await lab.checkDouble(kind);
    lab.env.FAKE_EOF_CODE = "7";
    const peer = lab.start({ shared: true });
    await peer.send(request);
    expect(await peer.response()).toEqual({ jsonrpc: "2.0", id: 1, result: "plain" });
    const child = await lab.event("start");
    expect(child.pid).toBe(peer.pid);
    peer.eof();
    expect((await peer.end()).code).toBe(7);
    expect(peer.notes().trim()).not.toBe("");
  }), 10_000,
);

async function hangingCheck(shell: string) {
  await inLaunch(async lab => {
    await lab.checkDouble("hang");
    const started = performance.now();
    const peer = lab.start({ shell, shared: true });
    await peer.send(request);
    expect(await peer.response(4000)).toEqual({ jsonrpc: "2.0", id: 1, result: "plain" });
    expect(performance.now() - started).toBeLessThanOrEqual(4000);
    const check = await lab.event("check");
    expect(alive(check.pid)).toBe(false);
    expect(peer.notes().trim()).not.toBe("");
    peer.eof();
    expect((await peer.end()).code).toBe(0);
  });
}

test("REQ-8 hanging-check-falls-back under sh with the first client frame intact", () => hangingCheck("sh"), 12_000);
test.skipIf(!dash)("REQ-8 hanging-check-falls-back under dash with the first client frame intact", () => hangingCheck(dash!), 12_000);

test.each([["SIGTERM", 143], ["SIGINT", 130], ["SIGHUP", 129]] as const)(
  "REQ-9 %s during check kills it and starts no server (%i)",
  (signal, code) => inLaunch(async lab => {
    await lab.checkDouble("hang");
    const peer = lab.start();
    const check = await lab.event("check");
    peer.signal(signal);
    expect(await peer.end(1000)).toEqual({ code, signal: null });
    await until(() => !alive(-peer.pid) && !alive(check.pid), "check group gone", 1000);
    expect(lab.events().filter(event => event.event === "start")).toEqual([]);
  }), 10_000,
);

test("REQ-8 plan failure after successful check leaves the server unstarted and exits 1", () => inLaunch(async lab => {
  // Restrict PATH, then let the real check pass before removing its only gopls.
  await lab.checkDouble("missing");
  await lab.checkDouble("remove");
  const peer = lab.start({ shared: true });
  expect((await peer.end()).code).toBe(1);
  expect(peer.notes()).toMatch(/gopls.*not found on PATH/i);
  expect(peer.output()).toHaveLength(0);
  expect(lab.events()).toEqual([]);
}), 12_000);

test("REQ-8 broken-relay-module-falls-back without consuming the client's initialize", () => inLaunch(async lab => {
  lab.breakRelayModule();
  const peer = lab.start({ shared: true });
  await peer.send(request);
  expect(await peer.response()).toEqual({ jsonrpc: "2.0", id: 1, result: "plain" });
  expect((await lab.event("start")).pid).toBe(peer.pid);
  expect(peer.notes().trim()).not.toBe("");
  peer.eof();
  expect((await peer.end()).code).toBe(0);
}), 12_000);

test("REQ-2 REQ-10 foreign cwd with spaces does not load bunfig or .env", () => inLaunch(async lab => {
  writeFileSync(join(lab.cwd, "bunfig.toml"), 'preload = ["./preload.ts"]\n');
  writeFileSync(join(lab.cwd, "preload.ts"), 'throw new Error("unexpected preload marker")\n');
  writeFileSync(join(lab.cwd, ".env"), "MAGUS_LSP_UNEXPECTED_DOTENV=from-project\n");
  // Do not supply the idle override: env-file suppression must preserve the default.
  delete lab.env.MAGUS_LSP_IDLE_MINUTES;
  delete lab.env.MAGUS_LSP_UNEXPECTED_DOTENV;
  const peer = lab.start();
  await peer.send(request);
  expect(await peer.response()).toEqual({ jsonrpc: "2.0", id: 1, result: "plain" });
  const child = await lab.event("start");
  expect(child.pid).not.toBe(peer.pid);
  expect(child.dotenv).toBeUndefined();
  peer.eof();
  expect((await peer.end()).code).toBe(0);
  expect(peer.notes()).not.toMatch(/unexpected preload marker/);
}), 10_000);

test("REQ-8 invalid idle config keeps a wrapped server and reports a note on stderr", () => inLaunch(async lab => {
  lab.env.MAGUS_LSP_IDLE_MINUTES = "broken";
  const peer = lab.start();
  await peer.send(request);
  expect(await peer.response()).toEqual({ jsonrpc: "2.0", id: 1, result: "plain" });
  expect((await lab.event("start")).pid).not.toBe(peer.pid);
  expect(peer.notes()).toContain("MAGUS_LSP_IDLE_MINUTES");
  peer.eof();
  expect((await peer.end()).code).toBe(0);
}), 10_000);
