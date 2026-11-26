import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { alive, bounded, inLaunch, until } from "./process-harness.ts";
import { frame, splitFrame } from "./wire.ts";

const msg = (method: string, id?: number, extra = {}) => frame({ jsonrpc: "2.0", method, id, ...extra });
const init = msg("initialize", 17);
const exit = msg("exit");
const response = (result: string) => ({ jsonrpc: "2.0", id: 17, result });

test.each([false, true])("REQ-4 exit-then-child-exits-2-gives-0: shared=%s, 100 launches", shared =>
  inLaunch(async lab => {
    lab.env.FAKE_EXIT_CODE = "2";
    lab.env.FAKE_EOF_CODE = "2";
    for (let i = 0; i < 100; i++) {
      const peer = lab.start({ shared });
      await peer.send(init);
      expect(await peer.response()).toEqual(response(shared ? "shared" : "plain"));
      await peer.send(exit);
      expect((await peer.end()).code).toBe(0);
      peer.destroyInput();
    }
    const events = lab.events();
    expect(events.filter(e => e.event === "start")).toHaveLength(100);
    expect(events.filter(e => e.event === "frame" && e.method === "exit")).toHaveLength(shared ? 0 : 100);
    if (shared) expect(events.filter(e => e.event === "eof")).toHaveLength(100);
  }), 150_000,
);

test("REQ-4 shared-exit-never-reaches-child even when client keeps its stdin open", () => inLaunch(async lab => {
  lab.env.FAKE_EOF_CODE = "2";
  const peer = lab.start({ shared: true });
  await peer.send(init);
  expect(await peer.response()).toEqual(response("shared"));
  await peer.send(frame('{"jsonrpc":"2.0","METHOD":"exit"}'));
  expect((await peer.end()).code).toBe(0);
  await lab.event("eof", e => e.shared);
  expect(lab.events().filter(e => e.event === "frame").map(e => e.method)).toEqual(["initialize"]);
}), 10_000);

test("REQ-4 EOF wins over a clean or nonzero child exit and does not start fallback", () => inLaunch(async lab => {
  for (const code of ["0", "2"]) {
    lab.env.FAKE_EOF_CODE = code;
    const peer = lab.start({ shared: true });
    peer.eof();
    expect((await peer.end()).code).toBe(0);
  }
  expect(lab.events().filter(e => e.event === "start").map(e => e.shared)).toEqual([true, true]);
}), 12_000);

test("REQ-4 client EOF wins below the queue limit even if the child never reads", () => inLaunch(async lab => {
  lab.env.FAKE_PLAIN = "never-read";
  const peer = lab.start();
  await lab.event("start");
  await bounded(peer.send(msg("initialize", 17, { pad: "x".repeat(2 * 1024 * 1024) })), "enqueue request", 3500);
  peer.eof();
  expect((await peer.end()).code).toBe(0);
}), 14_000);

test("REQ-2 shared-bad-header-exits-1 even when a valid exit follows", () => inLaunch(async lab => {
  const peer = lab.start({ shared: true });
  await peer.send(init);
  expect(await peer.response()).toEqual(response("shared"));
  await peer.send(Buffer.concat([Buffer.from("Content-Length: nope\r\n\r\n"), exit]));
  expect((await peer.end()).code).toBe(1);
  expect(lab.events().filter(e => e.event === "frame").map(e => e.method)).toEqual(["initialize"]);
}), 10_000);

test.each(['{"method":"exit","method":"other"}', '{"Method":"exit","method":null}', '{"method":17}'])(
  "REQ-2 ambiguous shared control frame %s triggers PROTOCOL before forwarding",
  body => inLaunch(async lab => {
    lab.env.FAKE_RAW = lab.raw;
    const peer = lab.start({ shared: true });
    await peer.send(init);
    expect(await peer.response()).toEqual(response("shared"));
    await peer.send(frame(body));
    expect((await peer.end()).code).toBe(1);
    expect(readFileSync(lab.raw + ".shared").equals(init)).toBe(true);
  }), 10_000,
);

test("REQ-2 REQ-3 plain-bad-header-goes-raw without mutation or idle stop", () => inLaunch(async lab => {
  lab.env.FAKE_PLAIN = "raw";
  lab.env.MAGUS_LSP_IDLE_MINUTES = ".005";
  const peer = lab.start();
  const malformed = Buffer.concat([Buffer.from("Content-Length: invalid\r\n\r\n"), init]);
  await peer.send(malformed);
  await until(() => peer.output().length >= malformed.length, "echoed malformed input");
  expect(peer.output().equals(malformed)).toBe(true);
  await Bun.sleep(450);
  expect(peer.stopped).toBe(false);
  peer.eof();
  expect((await peer.end()).code).toBe(0);
}), 10_000);

test("REQ-2 REQ-3 server-garbage-keeps-exit-rule and disables idle", () => inLaunch(async lab => {
  lab.env.FAKE_SHARED = "garbage";
  lab.env.MAGUS_LSP_IDLE_MINUTES = ".005";
  const peer = lab.start({ shared: true });
  // A complete malformed response establishes a parser error, not a partial header.
  await until(() => peer.output().includes("server-garbage"), "raw garbage");
  await Bun.sleep(450);
  expect(peer.stopped).toBe(false);
  await peer.send(exit);
  expect((await peer.end()).code).toBe(0);
  await lab.event("eof", e => e.shared);
  expect(lab.events().filter(e => e.event === "frame")).toEqual([]);
}), 10_000);

test("REQ-8 cap-switches-to-plain and replays a 5 MiB initialize byte for byte", () => inLaunch(async lab => {
  lab.env.FAKE_SHARED = "silent";
  lab.env.FAKE_RAW = lab.raw;
  const peer = lab.start({ shared: true });
  const large = msg("initialize", 17, { pad: "x".repeat(5 * 1024 * 1024) });
  await bounded(peer.send(large), "submit frame larger than replay cap", 6000);
  expect(await peer.response()).toEqual(response("plain"));
  expect(readFileSync(lab.raw + ".plain").equals(large)).toBe(true);
  peer.eof();
  expect((await peer.end()).code).toBe(0);
  expect(peer.notes()).toMatch(/daemon\./);
}), 14_000);

test.each(["die", "descendant"] as const)(
  "REQ-8 initialize-written-before-death-is-replayed and old-stdout-not-forwarded (%s)",
  mode => inLaunch(async lab => {
    lab.env.FAKE_SHARED = mode;
    lab.env.FAKE_RAW = lab.raw;
    const peer = lab.start({ shared: true });
    await peer.send(init);
    expect(await peer.response(6500)).toEqual(response("plain"));
    expect(readFileSync(lab.raw + ".shared").equals(init)).toBe(true);
    expect(readFileSync(lab.raw + ".plain").equals(init)).toBe(true);
    const first = await lab.event("start", e => e.shared);
    expect(alive(-first.pid)).toBe(false);
    if (mode === "descendant") {
      const grand = await lab.event("spawned-grandchild");
      expect(alive(grand.descendant!)).toBe(false);
    }
    peer.eof();
    expect((await peer.end()).code).toBe(0);
    expect(peer.output().equals(frame(response("plain")))).toBe(true);
  }), 15_000,
);

test("REQ-5 exit-with-buffered-byte-no-fallback passes through child code 3", () => inLaunch(async lab => {
  lab.env.FAKE_SHARED = "buffered";
  const peer = lab.start({ shared: true });
  expect((await peer.end()).code).toBe(3);
  await until(() => peer.output().length > 0, "buffered child byte");
  expect(peer.output().toString()).toBe("!");
  expect(lab.events().filter(e => e.event === "start").map(e => e.shared)).toEqual([true]);
}), 10_000);

test("REQ-8 plain-spawn-fails-exits-1 when gopls disappears during probation", () => inLaunch(async lab => {
  lab.env.FAKE_SHARED = "remove";
  const peer = lab.start({ shared: true });
  await peer.send(init);
  expect((await peer.end()).code).toBe(1);
  expect(peer.notes()).toMatch(/(?:enoent|no such file|spawn)/i);
  expect(lab.events().filter(e => e.event === "start").map(e => e.shared)).toEqual([true]);
}), 10_000);

test.each([["exit", "0", 1], ["exit", "7", 7], ["signalled", "0", 137]] as const)(
  "REQ-5 child %s with code %s propagates as %i without a client latch",
  (mode, code, expected) => inLaunch(async lab => {
    lab.env.FAKE_PLAIN = mode;
    lab.env.FAKE_EXIT_CODE = code;
    expect((await lab.start().end()).code).toBe(expected);
  }), 10_000,
);

test.each([["SIGTERM", 143], ["SIGINT", 130], ["SIGHUP", 129]] as const)(
  "REQ-9 wrapper %s exits %i and its server group is gone",
  (signal, code) => inLaunch(async lab => {
    const peer = lab.start();
    const child = await lab.event("start");
    peer.signal(signal);
    expect(await peer.end()).toEqual({ code, signal: null });
    await until(() => !alive(-child.pid), "child group gone", 5000);
  }), 15_000,
);

test("REQ-9 SIGKILL of the wrapper leaves a cooperative server to exit on stdin EOF", () => inLaunch(async lab => {
  const peer = lab.start();
  await peer.send(init);
  expect(await peer.response()).toEqual(response("plain"));
  const child = await lab.event("start");
  peer.signal("SIGKILL");
  expect(await peer.end()).toEqual({ code: null, signal: "SIGKILL" });
  await lab.event("eof");
  await until(() => !alive(-child.pid), "child group gone", 5000);
}), 12_000);

test("REQ-9 child-closes-stdin-stays-alive exits 1 within 6 s with empty group", () => inLaunch(async lab => {
  lab.env.FAKE_PLAIN = "closed-stdin";
  const peer = lab.start();
  const child = await lab.event("closed");
  const start = performance.now();
  // More than a pipe buffer: even if the first write was accepted, the transfer cannot complete.
  void peer.send(msg("initialize", 17, { pad: "x".repeat(2 * 1024 * 1024) })).catch(() => {});
  expect((await peer.end(6000)).code).toBe(1);
  expect(performance.now() - start).toBeLessThanOrEqual(6000);
  expect(alive(-child.pid)).toBe(false);
}), 13_000);

test("REQ-9 a live child with over 16 MiB queued stalls and exits 1", () => inLaunch(async lab => {
  lab.env.FAKE_PLAIN = "never-read";
  const peer = lab.start();
  const child = await lab.event("start");
  const unit = msg("work", 17, { pad: "x".repeat(1024 * 1024) });
  void peer.send(Buffer.concat(Array.from({ length: 22 }, () => unit))).catch(() => {});
  expect((await peer.end()).code).toBe(1);
  await until(() => !alive(-child.pid), "stalled child group gone", 5000);
}), 16_000);

test("REQ-4 EPIPE writing to the client exits 0", () => inLaunch(async lab => {
  const peer = lab.start({ readOutput: false });
  await lab.event("start");
  peer.proc.stdout.destroy();
  await peer.send(msg("initialize", 17));
  expect((await peer.end()).code).toBe(0);
}), 12_000);

test("REQ-9 client-not-reading-child-ignores-term exits at most 8 s after the signal latch", () => inLaunch(async lab => {
  lab.env.FAKE_PLAIN = "burst";
  const peer = lab.start({ readOutput: false });
  const child = await lab.event("burst");
  // Let the blocked pipe get a pending write before the termination signal.
  await Bun.sleep(150);
  const start = performance.now();
  peer.signal("SIGTERM");
  expect((await peer.end(8000)).code).toBe(143);
  expect(performance.now() - start).toBeLessThanOrEqual(8000);
  expect(alive(-child.pid)).toBe(false);
  expect(peer.notes()).toMatch(/(?:discard|cut|drop|unwritten)/i);
}), 15_000);

test("REQ-3 REQ-7 a partial request and then an in-flight request both prevent idle", () => inLaunch(async lab => {
  lab.env.FAKE_PLAIN = "silent";
  lab.env.MAGUS_LSP_IDLE_MINUTES = ".006";
  const peer = lab.start();
  await peer.send(init.subarray(0, init.length - 1));
  await lab.event("start");
  await Bun.sleep(550);
  expect(peer.stopped).toBe(false);
  await peer.send(init.subarray(-1));
  await lab.event("frame", e => e.id === 17);
  await Bun.sleep(550);
  expect(peer.stopped).toBe(false);
  peer.eof();
  expect((await peer.end()).code).toBe(0);
}), 10_000);

test("REQ-3 write-after-idle-gets-epipe while the wrapper is still alive", () => inLaunch(async lab => {
  lab.env.MAGUS_LSP_IDLE_MINUTES = ".005";
  lab.env.FAKE_PLAIN = "idle-probe";
  lab.env.FAKE_EOF_DELAY = "750";
  const peer = lab.start({ rawInput: true });
  await lab.event("eof");
  await Bun.sleep(50);
  expect(peer.stopped).toBe(false);
  expect(peer.writeRaw(init)).toBe("EPIPE");
  expect(alive(peer.pid)).toBe(true);
  expect((await peer.end()).code).toBe(1);
}), 10_000);

test("REQ-3 request-at-deadline is answered, refused with EPIPE, or ends in a visible idle stop, 50 launches", () => inLaunch(async lab => {
  lab.env.MAGUS_LSP_IDLE_MINUTES = ".003";
  let uncounted = 0;
  for (let i = 0; i < 50; i++) {
    const peer = lab.start({ rawInput: true });
    // Sweep across the deadline rather than require one scheduler ordering.
    const events = await until(() => {
      const starts = lab.events().filter(e => e.event === "start");
      return starts[i];
    }, "server start for deadline attempt " + i);
    expect(events.shared).toBe(false);
    await Bun.sleep(110 + (i % 9) * 15);
    const write = peer.writeRaw(init);
    expect((await peer.endAndDrain()).code).toBe(1);
    peer.destroyInput();
    if (write === "EPIPE") continue;

    const reply = splitFrame(peer.output());
    if (reply) {
      expect(reply.message).toEqual(response("plain"));
      continue;
    }
    // No reply: the stop must be visible, and any count it gives must be a real one.
    // The count itself is best-effort, because a read the runtime already has in
    // progress at the close can take the write without delivering it.
    const notes = peer.notes();
    expect(notes, `deadline attempt ${i + 1}: no reply and no idle stop`).toMatch(/no client activity[^\r\n]*stopping the server/);
    const counted = /\b(?:discard(?:ed)?|drop(?:ped)?)\b[^\r\n]*\b(\d+)\s+(?:client(?: input)?|stdin|input)\s+bytes\b/i.exec(notes);
    if (counted) expect(Number(counted[1])).toBeGreaterThan(0);
    else uncounted++;
  }
  // A lost line is the rare case, not the rule.
  expect(uncounted).toBeLessThanOrEqual(5);
}), 120_000);
