import { expect, test } from "bun:test";
import { Relay, type Child, type ChildExit, type Clock } from "../src/relay.ts";
import { frame } from "./wire.ts";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
class ManualClock implements Clock {
  private time = 0;
  private timers = new Map<object, { due: number; fn: () => void }>();
  now = () => this.time;
  setImmediate = (fn: () => void) => { setImmediate(fn); };
  setTimeout = (fn: () => void, ms: number) => {
    const handle = {};
    this.timers.set(handle, { due: this.time + ms, fn });
    return handle;
  };
  clearTimeout = (handle: unknown) => { this.timers.delete(handle as object); };
  async at(ms: number) {
    await tick();
    for (;;) {
      const next = [...this.timers].filter(([, timer]) => timer.due <= ms).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      this.timers.delete(next[0]);
      this.time = Math.max(this.time, next[1].due);
      next[1].fn();
      await tick();
    }
    this.time = ms;
    await tick();
  }
}

function lab({ shared = false, idleMs = 0, blockOutput = false, holdSharedStdout = false } = {}) {
  const clock = new ManualClock();
  let input!: ReadableStreamDefaultController<Uint8Array>;
  const clientIn = new ReadableStream<Uint8Array>({ start(controller) { input = controller; } });
  const children: {
    pid: number;
    argv: string[];
    sent: Buffer[];
    output(bytes: Buffer): void;
    endOutput(): void;
    die(code: number, keepOutput?: boolean): void;
  }[] = [];
  const groups = new Map<number, (code: number) => void>();
  const signals: string[] = [];
  const notes: string[] = [];
  let closed = false;
  let aborted = false;
  let attemptedOutput = false;
  const delivered: Buffer[] = [];
  const outGate = deferred<void>();
  const plainArgv = ["gopls"];
  const relay = new Relay(
    { argv: shared ? ["gopls", "-remote=auto;test"] : plainArgv, plainArgv,
      shared: shared ? { id: "test", socketPath: "gopls-test.sock" } : null, idleMs, notes: [] },
    {
      clock, clientIn,
      closeClientIn() { closed = true; },
      abortClientOut() { aborted = true; outGate.resolve(); },
      log(line) { notes.push(line); },
      clientOut: {
        async write(bytes) {
          attemptedOutput = true;
          if (blockOutput) await outGate.promise;
          if (!aborted) delivered.push(Buffer.from(bytes));
          return bytes.length;
        },
        flush() { return 0; },
        end() { return 0; },
      },
      kill(group, signal) {
        signals.push(group + ":" + signal);
        const end = groups.get(-group);
        if (!end) throw Object.assign(new Error("No such group"), { code: "ESRCH" });
        if (signal !== 0) end(2);
      },
      spawn(argv): Child {
        const pid = 70101 + children.length;
        const result = deferred<ChildExit>();
        const sent: Buffer[] = [];
        let output!: ReadableStreamDefaultController<Uint8Array>;
        const stdout = new ReadableStream<Uint8Array>({ start(controller) { output = controller; } });
        let exited = false;
        const die = (code: number, keepOutput = false) => {
          if (exited) return;
          exited = true;
          groups.delete(pid);
          if (!keepOutput) output.close();
          result.resolve({ code, signal: null });
        };
        groups.set(pid, die);
        children.push({
          pid, argv, sent, die,
          output(bytes) { output.enqueue(bytes); },
          endOutput() { output.close(); },
        });
        return {
          pid, stdout, exited: result.promise,
          stdin: {
            write(bytes) { sent.push(Buffer.from(bytes)); return bytes.length; },
            flush() { return 0; },
            end() {
              die(2, holdSharedStdout && argv.length > 1);
              return 0;
            },
          },
        };
      },
    },
  );
  const done = relay.run();
  return { relay, done, clock, input, children, signals, notes, delivered,
    get closed() { return closed; }, get aborted() { return aborted; }, get attemptedOutput() { return attemptedOutput; } };
}

test("REQ-8 silent-shared-falls-back-after-20s measured from the first client byte", async () => {
  const t = lab({ shared: true });
  await t.clock.at(25_000);
  expect(t.children).toHaveLength(1);
  const request = frame({ id: 17, method: "initialize" });
  t.input.enqueue(request);
  await t.clock.at(44_999);
  expect(t.children).toHaveLength(1);
  await t.clock.at(45_000);
  expect(t.children.map(c => c.argv)).toEqual([["gopls", "-remote=auto;test"], ["gopls"]]);
  expect(t.children[1].sent).toEqual([request]);
  expect(t.notes.join(" ")).toContain("gopls-test.sock");
  t.input.close();
  await t.clock.at(53_000);
  expect(await t.done).toBe(0);
});

test("REQ-3 REQ-8 replayed notification bytes do not reset the idle deadline", async () => {
  const t = lab({ shared: true, idleMs: 100 });
  const notice = frame({ method: "notice" });
  t.input.enqueue(notice);
  await t.clock.at(40);
  t.children[0].die(3);
  await tick();
  expect(t.children).toHaveLength(2);
  expect(t.children[1].sent).toEqual([notice]);
  await t.clock.at(99);
  expect(t.closed).toBe(false);
  await t.clock.at(100);
  expect(t.closed).toBe(true);
  await t.clock.at(2100);
  expect(await t.done).toBe(1);
});

test("REQ-4 REQ-8 exit in the same read that crosses the replay cap prevents plain spawn", async () => {
  const t = lab({ shared: true });
  const large = frame({ id: 17, method: "initialize", params: "x".repeat(4 * 1024 * 1024) });
  t.input.enqueue(Buffer.concat([large, frame({ method: "exit" })]));
  await t.clock.at(8000);
  expect(await t.done).toBe(0);
  expect(t.children).toHaveLength(1);
  expect(t.children[0].sent).toEqual([large]);
});

test("REQ-4 REQ-8 EOF during handoff abandons the replacement before the plain server starts", async () => {
  const t = lab({ shared: true, holdSharedStdout: true });
  t.input.enqueue(frame({ id: 17, method: "initialize" }));
  await t.clock.at(1);
  t.children[0].die(3, true);
  await tick();
  expect(t.children).toHaveLength(1);
  t.input.close();
  await t.clock.at(8000);
  expect(await t.done).toBe(0);
  expect(t.children).toHaveLength(1);
});

test("REQ-9 INTERNAL ends the active server, reports an error and wins over a later signal", async () => {
  const t = lab();
  await tick();
  t.relay.internal(new Error("synthetic relay failure"));
  t.relay.signal(143);
  await t.clock.at(8000);
  expect(await t.done).toBe(1);
  expect(t.notes.join(" ")).toContain("synthetic relay failure");
  expect(t.signals).toContain(t.children[0].pid * -1 + ":15");
});

test("REQ-9 no-group-signal-after-empty: an absent group is probed, never sent a signal", async () => {
  const t = lab();
  await tick();
  const [child] = t.children;
  child.die(7);
  await t.clock.at(8000);
  expect(await t.done).toBe(7);
  expect(t.signals.length).toBeGreaterThan(0);
  expect(new Set(t.signals)).toEqual(new Set([(-child.pid) + ":0"]));
});

test("REQ-9 blocked client output is aborted by 2 s after child reap, even with a write in progress", async () => {
  const t = lab({ blockOutput: true });
  await tick();
  const [child] = t.children;
  child.output(frame({ id: 1, result: "unread" }));
  await tick();
  expect(t.attemptedOutput).toBe(true);
  child.die(7);
  await t.clock.at(1999);
  expect(t.aborted).toBe(false);
  await t.clock.at(2000);
  expect(t.aborted).toBe(true);
  expect(await t.done).toBe(7);
  expect(t.delivered).toEqual([]);
  expect(t.notes.join(" ")).toMatch(/(?:discard|cut|drop|unwritten)/i);
});
