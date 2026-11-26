/**
 * The relay between Claude Code (the client, on stdin/stdout) and one server
 * process group.
 *
 * Client → server is parsed into frames, so a single `exit` can be held back;
 * server → client is relayed as raw chunks and parsed only to see responses.
 * The first terminal event latches a reason and an exit code; nothing after it
 * changes the code. Every path from the latch to exit is bounded.
 *
 * Client reads never wait on the child: each chunk is classified at once and
 * its writes are queued, so an EOF or `exit` is seen however slowly the child
 * reads. Over 16 MiB queued, reading pauses; still over it 3 s later, the
 * child counts as stalled.
 *
 * A shared start is on probation until its first stdout byte. If it dies,
 * stays silent for 20 s after the client spoke, or the client sends more than
 * 4 MiB first, the wrapper switches once to the plain server and replays what
 * the client sent. A client `exit` or EOF read first always wins.
 */

import { dlopen, FFIType } from "bun:ffi";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { constants } from "node:os";
import { type Frame, FrameParser, isExit, methodProblem, requestKey, responseKey } from "./framing.ts";
import { IdleTracker } from "./idle.ts";
import type { Plan } from "./plan.ts";

export type Reason = "CLIENT_END" | "SIGNAL" | "IDLE" | "PROTOCOL" | "CHILD" | "INTERNAL";

export interface Sink {
	write(chunk: Uint8Array): number | Promise<number>;
	flush(): number | Promise<number>;
	end(): number | Promise<number>;
}

export interface ChildExit {
	code: number | null;
	signal: string | null;
}

export interface Child {
	pid: number;
	stdin: Sink;
	stdout: ReadableStream<Uint8Array>;
	exited: Promise<ChildExit>;
}

export interface Clock {
	now(): number;
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	setImmediate(fn: () => void): void;
}

export interface RelayDeps {
	clock: Clock;
	/** Starts argv in its own process group. Throws when it cannot. */
	spawn(argv: string[]): Child;
	kill(pid: number, signal: number): void;
	clientIn: ReadableStream<Uint8Array>;
	clientOut: Sink;
	/**
	 * Closes the wrapper's stdin descriptor, so a later client write fails.
	 * Returns how many bytes were waiting in it, which are discarded, when that
	 * can be told.
	 */
	closeClientIn(): number | undefined;
	/** Stops delivering client output: nothing still held for stdout reaches the client. */
	abortClientOut(): void;
	log(line: string): void;
}

export const SHARED_CAP_BYTES = 4 * 1024 * 1024;
export const FIRST_BYTE_DEADLINE_MS = 20_000;
const GRACE_MS = 2_000;
const CLIENT_END_WAIT_MS = 3_000;
const STALLED_CHILD_MS = 3_000;
const HANDOFF_WAIT_MS = 2_000;
/** Client bytes waiting for the child above which stdin is not read. */
export const CHILD_QUEUE_BYTES = 16 * 1024 * 1024;
/** Upper bound from latch to exit, whatever the child does. */
const LATCH_TO_EXIT_MS = 8_000;
const PROBE_INTERVAL_MS = 50;
/** The longest delay a timer keeps; a longer one fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

const SIGTERM = constants.signals.SIGTERM;
const SIGKILL = constants.signals.SIGKILL;

export const systemClock: Clock = {
	now: () => performance.now(),
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	setImmediate: (fn) => {
		setImmediate(fn);
	},
};

export function spawnDetached(argv: string[]): Child {
	const proc = Bun.spawn(argv, { stdin: "pipe", stdout: "pipe", stderr: "inherit", detached: true });
	return {
		pid: proc.pid,
		stdin: proc.stdin,
		stdout: proc.stdout,
		exited: proc.exited.then(() => ({ code: proc.signalCode ? null : proc.exitCode, signal: proc.signalCode ?? null })),
	};
}

const POLLIN = 0x1;
/** Most bytes `drainUnread` reads in one call; a client still writing past it is not followed further. */
const DRAIN_LIMIT_BYTES = 16 * 1024 * 1024;

type PollFn = (fds: Uint8Array, nfds: bigint, timeout: number) => number;
let pollFn: PollFn | null | undefined;

/** libc `poll`, or null where it cannot be loaded. Loaded on first use only. */
function libcPoll(): PollFn | null {
	if (pollFn !== undefined) return pollFn;
	const lib =
		process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : process.platform === "linux" ? "libc.so.6" : null;
	pollFn = null;
	if (lib === null) return pollFn;
	try {
		const { symbols } = dlopen(lib, { poll: { args: [FFIType.ptr, FFIType.u64, FFIType.i32], returns: FFIType.i32 } });
		pollFn = symbols.poll as unknown as PollFn;
	} catch {
		pollFn = null;
	}
	return pollFn;
}

/**
 * Reads and counts what is waiting in a pipe or socket descriptor, never
 * blocking: each read follows a zero-timeout `poll` that reported data, so it
 * returns what is there. Works for anonymous pipes, named FIFOs and sockets
 * alike. Where `poll` cannot be loaded, macOS's descriptor size is the count
 * (0 for a named FIFO); elsewhere 0.
 */
export function drainUnread(fd: number): number {
	try {
		const st = fstatSync(fd);
		if (!st.isFIFO() && !st.isSocket()) return 0;
		const poll = libcPoll();
		if (poll === null) return process.platform === "darwin" ? Math.max(0, Number(st.size)) : 0;
		const pfd = new Uint8Array(8);
		const view = new DataView(pfd.buffer);
		const buf = Buffer.alloc(64 * 1024);
		let total = 0;
		while (total < DRAIN_LIMIT_BYTES) {
			// struct pollfd { int fd; short events; short revents; }
			view.setInt32(0, fd, true);
			view.setInt16(4, POLLIN, true);
			view.setInt16(6, 0, true);
			if (poll(pfd, 1n, 0) <= 0 || (view.getInt16(6, true) & POLLIN) === 0) break;
			let n: number;
			try {
				n = readSync(fd, buf, 0, buf.length, null);
			} catch {
				break;
			}
			if (n <= 0) break;
			total += n;
		}
		return total;
	} catch {
		return 0;
	}
}

export function systemDeps(): RelayDeps {
	return {
		clock: systemClock,
		spawn: spawnDetached,
		kill: (pid, signal) => process.kill(pid, signal),
		clientIn: Bun.stdin.stream(),
		clientOut: Bun.stdout.writer(),
		closeClientIn: () => {
			const unread = drainUnread(0);
			closeSync(0);
			// fd 0 becomes /dev/null, so the number is not reused for another file (a stderr duplicate took it otherwise).
			const spare = openSync("/dev/null", "r");
			if (spare !== 0) closeSync(spare);
			return unread;
		},
		abortClientOut: () => {
			// fd 1 becomes /dev/null, so a pending write goes nowhere and the number is never reused.
			closeSync(1);
			if (openSync("/dev/null", "w") === 0) openSync("/dev/null", "w");
		},
		log: (line) => process.stderr.write(`lsp: ${line}\n`),
	};
}

/** The wrapper's code for a child that ended on its own. */
export function childExitCode(exit: ChildExit): number {
	if (exit.signal) {
		const signo = (constants.signals as Record<string, number>)[exit.signal];
		return 128 + (signo ?? 0);
	}
	return exit.code === null || exit.code === 0 ? 1 : exit.code;
}

type WriteResult = { ok: true } | { ok: false; closed: boolean; error: unknown };

/** Error codes that mean the reading end is gone, not that the wrapper failed. */
const CLOSED_CODES = new Set(["EPIPE", "ECONNRESET"]);

/** Awaits a write and its flush; `closed` when the other end is gone. */
async function writeAll(sink: Sink, chunk: Uint8Array): Promise<WriteResult> {
	try {
		const written = sink.write(chunk);
		if (typeof written !== "number") await written;
		const flushed = sink.flush();
		if (typeof flushed !== "number") await flushed;
		return { ok: true };
	} catch (error) {
		const code = (error as NodeJS.ErrnoException | null)?.code;
		return { ok: false, closed: typeof code === "string" && CLOSED_CODES.has(code), error };
	}
}

function endQuietly(sink: Sink): void {
	try {
		const ended = sink.end();
		if (typeof ended !== "number") ended.catch(() => {});
	} catch {
		// Already closed by the other side.
	}
}

type Output = "forward" | "hold" | "discard";

interface ChunkReader {
	read(): Promise<{ done: true; value?: Uint8Array } | { done: false; value: Uint8Array }>;
	cancel(reason?: unknown): Promise<void>;
}

interface ChildState {
	proc: Child;
	mode: "shared" | "plain";
	/** Server-direction parser; null once its output stopped parsing. */
	parser: FrameParser | null;
	exit: ChildExit | null;
	reaped: Promise<ChildExit>;
	stdoutDone: Promise<void>;
	stdinClosed: boolean;
	stdinBroken: boolean;
	/** Serialises writes to the child: one chunk in flight. */
	writes: Promise<unknown>;
	/** Bytes accepted for the child and not yet written or failed. */
	queued: number;
	output: Output;
	held: Uint8Array[];
	onHeld: (() => void) | null;
	/** Settles once the output is written to the client or its deadline passed. */
	outputEnd: Promise<void> | null;
	/** This child's output reached the client or was reported discarded. */
	outputSettled: boolean;
}

interface Probation {
	retained: Uint8Array[];
	bytes: number;
	deadline: unknown;
}

export class Relay {
	private latched: Reason | null = null;
	private code = 1;
	private child!: ChildState;
	private readonly tracker: IdleTracker;
	private clientParser: FrameParser | null = new FrameParser();
	private readonly reader: ChunkReader;
	private stopReading = false;
	private probation: Probation | null = null;
	private fallbackUsed = false;
	private handoff: Promise<void> | null = null;
	/** Raw client chunks read during a handoff, written to the replacement after the replay. */
	private deferred: Uint8Array[] | null = null;
	private deferredBytes = 0;
	/** Resumes a client loop paused on the queue bound. */
	private wakeReader: (() => void) | null = null;
	private idleTimer: unknown = null;
	private idleTermAt = 0;
	private clientWrites: Promise<unknown> = Promise.resolve();
	private clientOutBroken = false;
	private unwrittenToClient = 0;
	/** Bytes of the client write in progress. */
	private inFlightToClient = 0;
	private clientOutAborted = false;
	private droppedFromClient = 0;
	private finished = false;
	private resolveDone!: (code: number) => void;
	private readonly done = new Promise<number>((resolve) => {
		this.resolveDone = resolve;
	});

	constructor(
		private readonly plan: Plan,
		private readonly deps: RelayDeps,
	) {
		this.tracker = new IdleTracker(plan.idleMs, () => deps.clock.now());
		this.reader = deps.clientIn.getReader();
	}

	/** Starts the server and relays until exit; resolves with the exit code. */
	run(): Promise<number> {
		try {
			this.child = this.startChild(this.plan.argv, this.plan.shared ? "shared" : "plain");
		} catch (error) {
			this.deps.log(`cannot start ${this.plan.argv[0]}: ${String(error)}`);
			this.finish(1);
			return this.done;
		}
		if (this.plan.shared) this.probation = { retained: [], bytes: 0, deadline: null };
		this.armIdle();
		this.clientLoop().catch((error) => this.internal(error));
		return this.done;
	}

	/** A wrapper signal: TERM 143, INT 130, HUP 129. */
	signal(code: number): void {
		this.latch("SIGNAL", code);
	}

	/** An error nothing handled: the process state is unknown, so end it. */
	internal(error: unknown): void {
		this.deps.log(`internal error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
		// Already latched: the latch-to-exit bound still ends the process.
		this.latch("INTERNAL", 1);
	}

	// ─── latch and termination ────────────────────────────────────────────

	private latch(reason: Reason, code: number): boolean {
		if (this.latched) return false;
		this.latched = reason;
		this.code = code;
		if (this.idleTimer !== null) this.deps.clock.clearTimeout(this.idleTimer);
		if (this.probation?.deadline) this.deps.clock.clearTimeout(this.probation.deadline);
		this.resumeReader();
		this.deps.clock.setTimeout(() => {
			if (!this.child.outputSettled) this.reportDiscarded();
			this.finish(this.code);
		}, LATCH_TO_EXIT_MS);
		// Started on a microtask so the latching caller finishes its own tick first.
		queueMicrotask(() => {
			this.terminate(reason).catch((error) => {
				this.deps.log(`termination failed: ${String(error)}`);
				this.finish(this.code);
			});
		});
		return true;
	}

	private async terminate(reason: Reason): Promise<void> {
		if (reason !== "CLIENT_END" && reason !== "IDLE") this.stopReading = true;
		const st = this.child;
		if (reason === "CLIENT_END") {
			await this.within(st.reaped, CLIENT_END_WAIT_MS);
			await this.endGroup(st);
		} else if (reason === "IDLE") {
			// TERM was sent in the latching tick.
			await this.within(st.reaped, GRACE_MS);
			await this.killIfAlive(st, this.idleTermAt);
		} else {
			await this.endGroup(st);
		}
		await this.within(st.reaped, GRACE_MS);
		await this.outputDeadline(st);
		this.finish(this.code);
	}

	/** Group TERM, up to 2 s for the group to empty, then group KILL. */
	private async endGroup(st: ChildState): Promise<void> {
		const termAt = this.deps.clock.now();
		if (!this.groupSignal(st, SIGTERM)) return;
		await this.within(st.reaped, GRACE_MS);
		await this.killIfAlive(st, termAt);
	}

	/** Waits for the group to empty until 2 s after the TERM, then KILLs what is left. */
	private async killIfAlive(st: ChildState, termAt: number): Promise<void> {
		while (this.groupAlive(st) && this.deps.clock.now() - termAt < GRACE_MS) {
			await this.sleep(PROBE_INTERVAL_MS);
		}
		this.groupSignal(st, SIGKILL);
	}

	/**
	 * One 2 s deadline, armed at the reap (or now, for a child never reaped),
	 * to read the rest of the child's output and write it to the client.
	 */
	private outputDeadline(st: ChildState): Promise<void> {
		if (st.outputEnd) return st.outputEnd;
		const flushed = (async () => {
			await st.stdoutDone;
			await this.clientWrites;
		})();
		st.outputEnd = this.within(flushed, GRACE_MS).then((ok) => {
			if (!ok && st.output === "forward") {
				st.output = "discard";
				if (st === this.child) {
					const cutOff = this.inFlightToClient > 0;
					this.abortClientOutput();
					this.reportDiscarded();
					// A write already in progress keeps going until the process ends.
					if (cutOff && this.latched) {
						this.groupSignal(st, SIGKILL);
						this.finish(this.code);
					}
				}
			}
			st.outputSettled = true;
		});
		return st.outputEnd;
	}

	/** The deadline passed: no more client output, including a write in progress. */
	private abortClientOutput(): void {
		if (this.clientOutAborted) return;
		this.clientOutAborted = true;
		try {
			this.deps.abortClientOut();
		} catch (error) {
			this.deps.log(`could not stop client output: ${String(error)}`);
		}
	}

	private reportDiscarded(): void {
		this.child.outputSettled = true;
		const queued = this.unwrittenToClient - this.inFlightToClient;
		const cut = this.inFlightToClient > 0 ? `, ${this.inFlightToClient} bytes in a write cut off` : "";
		this.deps.log(`discarded server output at exit: ${queued} bytes unwritten${cut}, the rest unread`);
	}

	private finish(code: number): void {
		if (this.finished) return;
		this.finished = true;
		if (this.droppedFromClient > 0) {
			this.deps.log(`dropped ${this.droppedFromClient} client bytes that arrived after the wrapper began to exit`);
		}
		this.resolveDone(code);
	}

	// ─── process groups ───────────────────────────────────────────────────

	private groupAlive(st: ChildState): boolean {
		try {
			this.deps.kill(-st.proc.pid, 0);
			return true;
		} catch (error) {
			return (error as NodeJS.ErrnoException)?.code === "EPERM";
		}
	}

	/** Probes first; a group that is gone gets no signal. */
	private groupSignal(st: ChildState, signal: number): boolean {
		if (!this.groupAlive(st)) return false;
		try {
			this.deps.kill(-st.proc.pid, signal);
		} catch {
			// The group emptied between the probe and the signal.
		}
		return true;
	}

	// ─── timers ───────────────────────────────────────────────────────────

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => this.deps.clock.setTimeout(resolve, ms));
	}

	/** True when `promise` settled within `ms`. */
	private within(promise: Promise<unknown>, ms: number): Promise<boolean> {
		return new Promise((resolve) => {
			const timer = this.deps.clock.setTimeout(() => resolve(false), ms);
			promise.then(
				() => {
					this.deps.clock.clearTimeout(timer);
					resolve(true);
				},
				() => {
					this.deps.clock.clearTimeout(timer);
					resolve(true);
				},
			);
		});
	}

	// ─── the child ────────────────────────────────────────────────────────

	private startChild(argv: string[], mode: "shared" | "plain"): ChildState {
		const proc = this.deps.spawn(argv);
		const st: ChildState = {
			proc,
			mode,
			parser: new FrameParser(),
			exit: null,
			reaped: Promise.resolve({ code: null, signal: null }),
			stdoutDone: Promise.resolve(),
			stdinClosed: false,
			stdinBroken: false,
			writes: Promise.resolve(),
			queued: 0,
			output: "forward",
			held: [],
			onHeld: null,
			outputEnd: null,
			outputSettled: false,
		};
		st.reaped = proc.exited.then((exit) => {
			st.exit = exit;
			if (st === this.child) void this.outputDeadline(st);
			this.onChildExit(st);
			return exit;
		});
		st.stdoutDone = this.pump(st).catch((error) => this.internal(error));
		return st;
	}

	/** The shared child being replaced: its exit and stalls belong to the handoff. */
	private beingReplaced(st: ChildState): boolean {
		return st !== this.child || (this.handoff !== null && st.mode === "shared");
	}

	private onChildExit(st: ChildState): void {
		if (this.latched || this.beingReplaced(st)) return;
		if (this.probation && !this.fallbackUsed) {
			this.startHandoff("a");
			return;
		}
		this.latch("CHILD", childExitCode(st.exit as ChildExit));
	}

	/** No write is accepted after this; writes already queued go out before the end. */
	private closeChildIn(st: ChildState): void {
		if (st.stdinClosed) return;
		st.stdinClosed = true;
		st.writes = st.writes.then(() => endQuietly(st.proc.stdin));
	}

	/** Queues a write to the child; resolves when it is done or failed. */
	private writeChild(st: ChildState, chunk: Uint8Array): Promise<unknown> {
		if (st.stdinClosed) return st.writes;
		st.queued += chunk.length;
		const next = st.writes.then(async () => {
			try {
				if (st.stdinBroken) return;
				const result = await writeAll(st.proc.stdin, chunk);
				if (result.ok) return;
				st.stdinBroken = true;
				if (!result.closed && !this.latched && !this.beingReplaced(st)) {
					this.internal(result.error);
					return;
				}
				this.onChildStalled(st);
			} finally {
				st.queued -= chunk.length;
				if (this.waitingBytes() <= CHILD_QUEUE_BYTES) this.resumeReader();
			}
		});
		st.writes = next;
		return next;
	}

	/** The child closed its stdin: if it is still alive after a while, end it. */
	private onChildStalled(st: ChildState): void {
		if (this.latched) return;
		this.deps.clock.setTimeout(() => {
			if (!this.latched && !this.beingReplaced(st) && st.exit === null) this.latch("CHILD", 1);
		}, STALLED_CHILD_MS);
	}

	private async pump(st: ChildState): Promise<void> {
		const reader = st.proc.stdout.getReader();
		for (;;) {
			let result: Awaited<ReturnType<typeof reader.read>>;
			try {
				result = await reader.read();
			} catch (error) {
				if (!this.latched && !this.beingReplaced(st)) this.internal(error);
				return;
			}
			if (result.done) return;
			const chunk = result.value;
			if (st.output === "discard") continue;
			if (st.output === "hold") {
				st.held.push(chunk);
				st.onHeld?.();
				continue;
			}
			if (st === this.child && this.probation) this.endProbation();
			this.observeServer(st, chunk);
			await this.writeClient(chunk);
		}
	}

	private observeServer(st: ChildState, chunk: Uint8Array): void {
		if (!st.parser) return;
		const { frames, error } = st.parser.push(chunk);
		for (const frame of frames) {
			const key = responseKey(frame.message);
			if (key !== null) this.tracker.response(key);
		}
		if (error) {
			st.parser = null;
			if (this.tracker.enabled) this.deps.log(`server output is not LSP (${error}); idle stop is off`);
			this.tracker.disable();
		}
	}

	private writeClient(chunk: Uint8Array): Promise<unknown> {
		if (this.clientOutAborted) return Promise.resolve();
		this.unwrittenToClient += chunk.length;
		this.clientWrites = this.clientWrites.then(async () => {
			if (this.clientOutBroken || this.clientOutAborted) return;
			this.inFlightToClient = chunk.length;
			const result = await writeAll(this.deps.clientOut, chunk);
			this.inFlightToClient = 0;
			if (this.clientOutAborted) return;
			this.unwrittenToClient -= chunk.length;
			if (result.ok) return;
			this.clientOutBroken = true;
			if (!result.closed && !this.latched) {
				this.internal(result.error);
				return;
			}
			if (this.latch("CLIENT_END", 0)) this.closeChildIn(this.child);
		});
		return this.clientWrites;
	}

	// ─── the client ───────────────────────────────────────────────────────

	private async clientLoop(): Promise<void> {
		for (;;) {
			for (let wait = this.roomToRead(); wait; wait = this.roomToRead()) await wait;
			if (this.stopReading) return;
			let result: Awaited<ReturnType<ChunkReader["read"]>>;
			try {
				result = await this.reader.read();
			} catch (error) {
				// After a latch fd 0 is closed on purpose.
				if (!this.latched) this.internal(error);
				return;
			}
			// EOF ends the client at once, even while a handoff runs.
			if (result.done) {
				if (this.latch("CLIENT_END", 0)) this.closeChildIn(this.child);
				return;
			}
			if (this.latched || this.stopReading) {
				this.droppedFromClient += result.value.length;
				if (this.stopReading) return;
				continue;
			}
			this.onClientChunk(result.value);
		}
	}

	/** Client bytes accepted and not yet written to a child. */
	private waitingBytes(): number {
		return this.child.queued + this.deferredBytes;
	}

	private resumeReader(): void {
		const wake = this.wakeReader;
		this.wakeReader = null;
		wake?.();
	}

	/**
	 * Null while the client may be read; otherwise a promise that settles when
	 * the queue is back under the bound, a handoff ends, or something latched.
	 * Over the bound for 3 s with the child alive, the child counts as stalled.
	 */
	private roomToRead(): Promise<void> | null {
		if (this.latched || this.waitingBytes() <= CHILD_QUEUE_BYTES) return null;
		return new Promise((resolve) => {
			this.wakeReader = resolve;
			// A handoff ends within its own bounds and wakes the reader.
			if (this.deferred !== null) return;
			const st = this.child;
			this.deps.clock.setTimeout(() => {
				if (this.wakeReader !== resolve || this.latched || st !== this.child || st.exit !== null) return;
				if (this.waitingBytes() <= CHILD_QUEUE_BYTES) return;
				this.deps.log(`server read too little of ${st.queued} queued bytes for ${STALLED_CHILD_MS / 1000} s; stopping`);
				this.latch("CHILD", 1);
			}, STALLED_CHILD_MS);
		});
	}

	/**
	 * Classifies every frame of the read before anything is written or a
	 * fallback starts, then queues the writes without waiting for them.
	 */
	private onClientChunk(chunk: Uint8Array): void {
		this.tracker.chunk();
		const st = this.child;
		// During a handoff the replacement is plain and gets the raw bytes after the replay.
		const replacing = this.deferred !== null;
		const shared = !replacing && st.mode === "shared";
		let frames: Frame[] = [];
		let error: string | null = null;
		let rest: Uint8Array = chunk;
		if (this.clientParser) {
			({ frames, error, rest } = this.clientParser.push(chunk));
			this.tracker.setPartial(this.clientParser.partial);
		}
		let exitAt = -1;
		let problemAt = -1;
		for (let i = 0; i < frames.length; i++) {
			const frame = frames[i] as Frame;
			// In shared mode the control fields are checked first: an ambiguous `exit` is PROTOCOL.
			const problem = shared ? methodProblem(frame) : null;
			if (problem) {
				problemAt = i;
				error = problem;
				break;
			}
			if (isExit(frame.message)) {
				exitAt = i;
				break;
			}
		}
		const cut = exitAt >= 0 ? exitAt : problemAt >= 0 ? problemAt : frames.length;
		const permitted = frames.slice(0, cut);
		for (const frame of permitted) {
			const key = requestKey(frame.message);
			if (key !== null) this.tracker.request(key);
		}

		if (exitAt >= 0) {
			this.latch("CLIENT_END", 0);
			if (replacing) {
				// The handoff is abandoned; nothing reaches a child.
				this.droppedFromClient += chunk.length;
				return;
			}
			for (const frame of permitted) this.writeChild(st, frame.bytes);
			if (st.mode === "plain") this.writeChild(st, (frames[exitAt] as Frame).bytes);
			this.closeChildIn(st);
			for (const frame of frames.slice(exitAt + 1)) this.droppedFromClient += frame.bytes.length;
			if (error) this.droppedFromClient += rest.length;
			return;
		}

		if (shared && error) {
			for (const frame of permitted) this.writeChild(st, frame.bytes);
			this.deps.log(`client sent something that is not LSP (${error}) to a shared server; stopping`);
			this.stopReading = true;
			this.closeChildIn(st);
			this.latch("PROTOCOL", 1);
			return;
		}

		const probation = this.probation;
		if (probation && !this.fallbackUsed) {
			if (probation.bytes + chunk.length > SHARED_CAP_BYTES) {
				void this.startHandoff("c");
			} else {
				probation.retained.push(chunk);
				probation.bytes += chunk.length;
				if (probation.deadline === null) {
					probation.deadline = this.deps.clock.setTimeout(() => {
						if (this.probation === probation && !this.latched) void this.startHandoff("b");
					}, FIRST_BYTE_DEADLINE_MS);
				}
			}
		}

		if (this.deferred !== null) {
			this.deferred.push(chunk);
			this.deferredBytes += chunk.length;
		} else if (!this.clientParser) {
			this.writeChild(st, chunk);
		} else {
			for (const frame of frames) this.writeChild(st, frame.bytes);
		}
		if (error && this.clientParser) {
			this.deps.log(`client sent something that is not LSP (${error}); relaying raw, idle stop is off`);
			this.clientParser = null;
			this.tracker.disable();
			this.tracker.setPartial(false);
			if (this.deferred === null) this.writeChild(st, rest);
		}
	}

	// ─── idle ─────────────────────────────────────────────────────────────

	private armIdle(): void {
		const remaining = this.tracker.remainingMs();
		if (remaining === null || this.latched) return;
		const wait = remaining > 0 ? remaining : this.tracker.idleMs;
		this.idleTimer = this.deps.clock.setTimeout(() => this.onIdleTimer(), Math.min(wait, MAX_TIMER_MS));
	}

	private onIdleTimer(): void {
		this.idleTimer = null;
		if (this.latched) return;
		const mark = this.tracker.candidate();
		if (!mark || this.handoff) {
			this.armIdle();
			return;
		}
		this.deps.clock.setImmediate(() => {
			if (this.latched) return;
			if (this.handoff || !this.tracker.recheck(mark)) {
				this.armIdle();
				return;
			}
			this.stopIdle();
		});
	}

	/**
	 * Everything in one tick, so a client write after this fails at the writer.
	 * Bytes the client already wrote are lost to it and counted on stderr at
	 * exit where they can be seen: those still in the descriptor are drained at
	 * the close, and the reader is left running rather than cancelled, so a
	 * chunk the runtime delivers after the latch is counted in the client loop.
	 * The count is best-effort: a read the runtime already has in progress can
	 * still take a write that lands at this moment and never deliver it, so
	 * that write is lost with no line. The exit code is 1 either way.
	 */
	private stopIdle(): void {
		if (!this.latch("IDLE", 1)) return;
		try {
			const unread = this.deps.closeClientIn();
			if (typeof unread === "number" && unread > 0) this.droppedFromClient += unread;
		} catch (error) {
			this.deps.log(`could not close stdin: ${String(error)}`);
		}
		const st = this.child;
		this.closeChildIn(st);
		this.idleTermAt = this.deps.clock.now();
		this.groupSignal(st, SIGTERM);
		this.deps.log(`no client activity for ${this.plan.idleMs / 60_000} min; stopping the server`);
	}

	// ─── shared-start fallback ────────────────────────────────────────────

	private endProbation(): void {
		if (this.probation?.deadline) this.deps.clock.clearTimeout(this.probation.deadline);
		this.probation = null;
	}

	private startHandoff(trigger: "a" | "b" | "c"): Promise<void> {
		if (this.handoff) return this.handoff;
		if (this.fallbackUsed || this.latched || !this.probation) return Promise.resolve();
		this.fallbackUsed = true;
		this.deferred = [];
		const handoff = this.runHandoff(trigger)
			.catch((error) => this.internal(error))
			.finally(() => {
				this.handoff = null;
				// Abandoned: what was read during it reaches no child.
				if (this.deferred !== null) {
					this.droppedFromClient += this.deferredBytes;
					this.deferred = null;
					this.deferredBytes = 0;
				}
				this.resumeReader();
			});
		this.handoff = handoff;
		return handoff;
	}

	private async runHandoff(trigger: "a" | "b" | "c"): Promise<void> {
		const probation = this.probation as Probation;
		if (probation.deadline) this.deps.clock.clearTimeout(probation.deadline);
		probation.deadline = null;
		const old = this.child;
		old.output = "hold";
		this.groupSignal(old, SIGKILL);
		await this.waitOldOutput(old);

		if (trigger === "a" && old.held.length > 0) {
			// Output arrived after all: probation had ended, so this is an ordinary exit.
			this.probation = null;
			const held = old.held;
			old.held = [];
			for (const chunk of held) {
				this.observeServer(old, chunk);
				void this.writeClient(chunk);
			}
			old.output = "forward";
			this.latch("CHILD", childExitCode(old.exit ?? { code: null, signal: null }));
			return;
		}
		old.output = "discard";
		old.held = [];
		old.stdinBroken = true;
		this.closeChildIn(old);
		if (this.latched) return;

		const goneBy = this.deps.clock.now() + HANDOFF_WAIT_MS;
		while (this.groupAlive(old) && this.deps.clock.now() < goneBy) await this.sleep(PROBE_INTERVAL_MS);
		if (this.latched) return;

		this.probation = null;
		let plain: ChildState;
		try {
			plain = this.startChild(this.plan.plainArgv, "plain");
		} catch (error) {
			this.deps.log(`cannot start plain ${this.plan.plainArgv[0]}: ${String(error)}`);
			this.latch("INTERNAL", 1);
			return;
		}
		this.child = plain;
		this.clientParser?.markDelivered();
		const why = {
			a: "exited before answering",
			b: `sent nothing for ${FIRST_BYTE_DEADLINE_MS / 1000} s after the client spoke`,
			c: `was sent over ${SHARED_CAP_BYTES / (1024 * 1024)} MiB before answering`,
		}[trigger];
		this.deps.log(`shared gopls (socket ${this.plan.shared?.socketPath ?? "?"}) ${why}; switching to a plain server`);
		// Replayed bytes are neither parsed again nor activity. Everything is queued in
		// read order in this tick: the retained bytes, then what arrived during the handoff.
		for (const chunk of probation.retained) this.writeChild(plain, chunk);
		const deferred = this.deferred ?? [];
		this.deferred = null;
		this.deferredBytes = 0;
		for (const chunk of deferred) this.writeChild(plain, chunk);
		this.resumeReader();
	}

	/** Resolves at the old child's stdout EOF, its first byte, or after 2 s. */
	private waitOldOutput(old: ChildState): Promise<void> {
		return new Promise((resolve) => {
			if (old.held.length > 0) return resolve();
			const timer = this.deps.clock.setTimeout(resolve, HANDOFF_WAIT_MS);
			const done = () => {
				this.deps.clock.clearTimeout(timer);
				old.onHeld = null;
				resolve();
			};
			old.onHeld = done;
			old.stdoutDone.then(done, done);
		});
	}
}
