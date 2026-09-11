/**
 * The Stop hook that keeps a `/madbench:bench` turn open while its operator is still
 * working.
 *
 * Every case reads a transcript out of `testdata/`, in the record shapes Claude Code
 * actually writes. The one thing that is never taken from the wall clock is `now`: the
 * hook treats a dispatch older than 45 minutes as dead, so a test that used the real
 * time would pass today and fail 45 minutes after the testdata was written. Each case
 * derives `now` from the dispatch timestamp in the file it reads.
 *
 * The end-to-end cases spawn the script as a real process, because "the pure function
 * returns a reason" and "the hook writes block JSON to stdout and exits 0" are different
 * claims and only the second one is what Claude Code reads.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyse,
  blockReason,
  decide,
  MAX_BLOCKS,
  priorBlocksInTranscript,
  readTranscript,
  SENTINEL,
  STALE_AFTER_MS,
} from "./stop-wait-for-operator.ts";

const TESTDATA = join(import.meta.dir, "testdata");
const SCRIPT = join(import.meta.dir, "stop-wait-for-operator.ts");
const OPERATOR_TASK = "a1d5d4f54162a0266";

function transcript(name: string): string {
  return readFileSync(join(TESTDATA, `${name}.jsonl`), "utf-8");
}

/** A moment one minute after the first operator dispatch in the file — well inside the age limit. */
function justAfterDispatch(text: string): number {
  const at = analyse(text).dispatches[0]?.at;
  if (at === undefined) throw new Error("testdata has no timestamped dispatch");
  return at + 60_000;
}

/**
 * Copy a testdata transcript into a temporary file with every timestamp moved to now.
 *
 * Needed only by the process-level cases, which cannot be handed a `now`.
 */
function freshlyDated(name: string): string {
  const stamp = new Date().toISOString();
  const text = transcript(name).replace(/"timestamp":"[^"]+"/g, `"timestamp":"${stamp}"`);
  const path = join(mkdtempSync(join(tmpdir(), "madbench-stop-wait-test-")), `${name}.jsonl`);
  writeFileSync(path, text);
  return path;
}

/** Run the hook as Claude Code runs it: JSON on stdin, read stdout and the exit code. */
async function runHook(input: unknown): Promise<{ code: number; stdout: string }> {
  const child = Bun.spawn(["bun", "--env-file=/dev/null", SCRIPT], {
    stdin: new TextEncoder().encode(JSON.stringify(input)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(child.stdout).text();
  const code = await child.exited;
  return { code, stdout };
}

describe("decide", () => {
  test("(a) no operator dispatch at all -> allow", () => {
    // A general-purpose agent was dispatched and finished. Nothing here is ours, and the
    // early exit means the file is never even parsed.
    const text = transcript("no-dispatch");
    expect(text).toContain('"subagent_type":"general-purpose"');
    expect(analyse(text).dispatches).toEqual([]);
    expect(decide(text, { now: Date.parse("2026-09-09T15:39:00.000Z") })).toBeNull();
  });

  test("(b) dispatch with no report -> block, naming the task id", () => {
    const text = transcript("dispatch-unreported");
    const verdict = decide(text, { now: justAfterDispatch(text) });
    expect(verdict).not.toBeNull();
    expect(verdict?.taskId).toBe(OPERATOR_TASK);
    expect(verdict?.reason).toContain(OPERATOR_TASK);
    expect(verdict?.reason).toContain("TaskOutput");
    expect(verdict?.reason).toContain("block: true");
    expect(verdict?.reason).toContain("timeout: 600000");
  });

  test("(c) task-notification with a terminal status -> allow", () => {
    const text = transcript("dispatch-notified");
    expect(decide(text, { now: justAfterDispatch(text) })).toBeNull();
  });

  test("(d) TaskOutput result carrying the report -> allow", () => {
    const text = transcript("dispatch-taskoutput-done");
    expect(decide(text, { now: justAfterDispatch(text) })).toBeNull();
  });

  test("(e) six prior blocks for this task id -> allow", () => {
    const text = transcript("dispatch-six-blocks");
    expect(priorBlocksInTranscript(text, OPERATOR_TASK)).toBe(MAX_BLOCKS);
    expect(decide(text, { now: justAfterDispatch(text) })).toBeNull();
  });

  test("(f) an unreadable transcript path reads as null, and null never blocks", () => {
    expect(readTranscript(join(TESTDATA, "no-such-file.jsonl"))).toBeNull();
    expect(readTranscript(undefined)).toBeNull();
    expect(readTranscript(TESTDATA)).toBeNull(); // a directory, not a file
  });

  test("(g) two dispatches, the first reported and the second not -> block on the second", () => {
    const text = transcript("two-dispatches");
    const { dispatches } = analyse(text);
    expect(dispatches.map((d) => d.agentId)).toEqual(["a258a51009b0749c3", OPERATOR_TASK]);
    const verdict = decide(text, { now: justAfterDispatch(text) });
    expect(verdict?.taskId).toBe(OPERATOR_TASK);
  });

  test("a TaskOutput that came back 'still running' does not count as a report", () => {
    const text = transcript("dispatch-taskoutput-running");
    expect(decide(text, { now: justAfterDispatch(text) })?.taskId).toBe(OPERATOR_TASK);
  });

  test("a dispatch older than 45 minutes is treated as dead -> allow", () => {
    const text = transcript("dispatch-unreported");
    const at = analyse(text).dispatches[0]!.at!;
    expect(decide(text, { now: at + STALE_AFTER_MS - 1000 })?.taskId).toBe(OPERATOR_TASK);
    expect(decide(text, { now: at + STALE_AFTER_MS + 1000 })).toBeNull();
  });

  test("blocks counted from outside the transcript also trip the cap", () => {
    const text = transcript("dispatch-unreported");
    const now = justAfterDispatch(text);
    expect(decide(text, { now, extraBlocks: () => MAX_BLOCKS - 1 })).not.toBeNull();
    expect(decide(text, { now, extraBlocks: () => MAX_BLOCKS })).toBeNull();
  });

  test("garbage in the transcript is ignored, not treated as a dispatch", () => {
    expect(decide("not json at all\n{\n", { now: Date.now() })).toBeNull();
    expect(decide("", { now: Date.now() })).toBeNull();
  });

  test("the block reason carries a sentinel a later invocation can count", () => {
    expect(priorBlocksInTranscript(blockReason(OPERATOR_TASK), OPERATOR_TASK)).toBe(1);
    expect(priorBlocksInTranscript(blockReason(OPERATOR_TASK), "other-id")).toBe(0);
    expect(blockReason(OPERATOR_TASK)).toContain(SENTINEL);
  });
});

describe("the hook as a process", () => {
  test("an unreported dispatch prints block JSON and still exits 0", async () => {
    // The process path has no `now` to inject, so it reads the real clock and would call
    // the dated testdata dead. Re-dating a copy is the only way to exercise it.
    const path = freshlyDated("dispatch-unreported");
    const { code, stdout } = await runHook({
      session_id: `test-${Date.now()}-unreported`,
      transcript_path: path,
      stop_hook_active: false,
      cwd: process.cwd(),
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { decision: string; reason: string };
    expect(parsed.decision).toBe("block");
    expect(parsed.reason).toContain(OPERATOR_TASK);
    expect(parsed.reason).toContain("Do not reply.");
  });

  test("blocking six times in one session stops on the seventh, even with an empty transcript count", async () => {
    // stop_hook_active means the model is already continuing from one of our blocks. The
    // hook keeps blocking, and the on-disk tally is what eventually ends it — this case
    // uses a transcript that carries none of our sentinels, so the tally is the only count.
    const path = freshlyDated("dispatch-unreported");
    expect(priorBlocksInTranscript(readFileSync(path, "utf-8"), OPERATOR_TASK)).toBe(0);
    const session = `test-${Date.now()}-cap`;
    const outputs: string[] = [];
    for (let attempt = 0; attempt < MAX_BLOCKS + 1; attempt++) {
      const { code, stdout } = await runHook({
        session_id: session,
        transcript_path: path,
        stop_hook_active: attempt > 0,
      });
      expect(code).toBe(0);
      outputs.push(stdout);
    }
    expect(outputs.slice(0, MAX_BLOCKS).every((o) => o.includes('"block"'))).toBe(true);
    expect(outputs[MAX_BLOCKS]).toBe("");
  });

  test("a transcript with no operator prints nothing and exits 0", async () => {
    const { code, stdout } = await runHook({
      session_id: `test-${Date.now()}-none`,
      transcript_path: join(TESTDATA, "no-dispatch.jsonl"),
      stop_hook_active: false,
    });
    expect(code).toBe(0);
    expect(stdout).toBe("");
  });

  test("a missing transcript prints nothing and exits 0", async () => {
    const { code, stdout } = await runHook({
      session_id: `test-${Date.now()}-missing`,
      transcript_path: join(TESTDATA, "no-such-file.jsonl"),
      stop_hook_active: true,
    });
    expect(code).toBe(0);
    expect(stdout).toBe("");
  });

  test("stdin that is not JSON prints nothing and exits 0", async () => {
    const child = Bun.spawn(["bun", "--env-file=/dev/null", SCRIPT], {
      stdin: new TextEncoder().encode("}{ not json"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(stdout).toBe("");
  });
});
