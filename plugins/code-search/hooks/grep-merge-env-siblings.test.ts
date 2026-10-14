/**
 * grep-merge-env-siblings.test.ts — P7 step 5: a source line in a SIBLING hook file counts
 * as present (revision 13, R13.1).
 *
 * Claude Code 2.1.299 hands each SessionStart event source of one session id its own
 * `sessionstart-hook-<n>.sh` inside `session-env/<id>/`, and splices every such file into
 * each Bash call. The rows below are R13.1's blind rows 1–16 and its unit rows, written from
 * the contract. The process rows run the hook the way hooks.json does, from a COPY of the
 * plugin tree, with the gate open.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capture } from "../test-support/grep-merge-harness";
import {
  envLineBytes,
  HOOK_FILE_PATTERN,
  isHookFileName,
  SIBLING_MAX_BYTES,
  SIBLING_MAX_FILES,
  type SiblingIo,
  siblingHoldingSourceLine,
  sourceLineOf,
} from "./grep-merge-env";

const PLUGIN = join(import.meta.dir, "..");
const ENGINE = { engine: "mnemex", engines: { mnemex: { command: "true" } } };
const SILENT = { rc: 0, stdout: "", stderr: "" };
const isRoot = process.getuid?.() === 0;

/** Every name R13.1 row 6 lists: the line in such a file never counts. */
const NON_MATCHING = [
  "sessionstart-hook-6.sh.bak",
  "SessionStart-hook-6.sh",
  "sessionstart-hook-.sh",
  "sessionstart-hook-6a.sh",
  "sessionstart-hook-6.txt",
  "sessionstart-hook-1234567890.sh",
  "env.sh",
];

/** Occurrences of `line` as a whole line in `text`. */
function countLine(text: string, line: string): number {
  return text.split("\n").filter((l) => l === line).length;
}

describe("constants and isHookFileName", () => {
  test("the exported caps and pattern", () => {
    expect(SIBLING_MAX_BYTES).toBe(65_536);
    expect(SIBLING_MAX_FILES).toBe(16);
    expect(HOOK_FILE_PATTERN.source).toBe("^sessionstart-hook-[0-9]{1,9}\\.sh$");
  });

  test.each(["sessionstart-hook-3.sh", "sessionstart-hook-123456789.sh"])("%s is a hook file name", (name) => {
    expect(isHookFileName(name)).toBe(true);
  });

  test.each(NON_MATCHING)("%s is not a hook file name", (name) => {
    expect(isHookFileName(name)).toBe(false);
  });
});

describe("siblingHoldingSourceLine (direct calls)", () => {
  let dir: string;
  const line = sourceLineOf("/p/assets/grep-merge.sh") ?? "";

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "csgm-sib-")));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("no other file in the directory: no holder, no notes", () => {
    expect(siblingHoldingSourceLine(join(dir, "sessionstart-hook-3.sh"), line)).toEqual({ holder: undefined, notes: [] });
  });

  test("a missing directory: no holder, no notes", () => {
    expect(siblingHoldingSourceLine(join(dir, "missing", "sessionstart-hook-3.sh"), line)).toEqual({ holder: undefined, notes: [] });
  });

  test("the target's own name is never the holder, even when it holds the line", () => {
    writeFileSync(join(dir, "sessionstart-hook-3.sh"), `${line}\n`);
    expect(siblingHoldingSourceLine(join(dir, "sessionstart-hook-3.sh"), line)).toEqual({ holder: undefined, notes: [] });
  });

  test("siblings -10 and -2 both hold the line: -2 wins (numeric order)", () => {
    writeFileSync(join(dir, "sessionstart-hook-10.sh"), `${line}\n`);
    writeFileSync(join(dir, "sessionstart-hook-2.sh"), `${line}\n`);
    expect(siblingHoldingSourceLine(join(dir, "sessionstart-hook-3.sh"), line)).toEqual({ holder: "sessionstart-hook-2.sh", notes: [] });
  });

  test("never writes: the listing, and the sibling's bytes and mtime, are unchanged", async () => {
    const sibling = join(dir, "sessionstart-hook-6.sh");
    writeFileSync(sibling, "export A=1\n");
    const before = statSync(sibling).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 15));
    siblingHoldingSourceLine(join(dir, "sessionstart-hook-3.sh"), line);
    expect(readdirSync(dir)).toEqual(["sessionstart-hook-6.sh"]);
    expect(readFileSync(sibling, "utf8")).toBe("export A=1\n");
    expect(statSync(sibling).mtimeMs).toBe(before);
  });

  test("an ignored sibling before the holder: holder named, and the earlier note kept", () => {
    writeFileSync(join(dir, "outside.sh"), `${line}\n`);
    symlinkSync(join(dir, "outside.sh"), join(dir, "sessionstart-hook-2.sh"));
    writeFileSync(join(dir, "sessionstart-hook-6.sh"), `${line}\n`);
    const scan = siblingHoldingSourceLine(join(dir, "sessionstart-hook-3.sh"), line);
    expect(scan.holder).toBe("sessionstart-hook-6.sh");
    expect(scan.notes).toHaveLength(1);
    expect(scan.notes[0]).toStartWith("sibling sessionstart-hook-2.sh ignored: ");
  });

  test("exactly 16 non-holding siblings: no holder and no `scan stopped` note", () => {
    for (let n = 1; n <= 16; n += 1) writeFileSync(join(dir, `sessionstart-hook-${n}.sh`), "export A=1\n");
    expect(siblingHoldingSourceLine(join(dir, "sessionstart-hook-99.sh"), line)).toEqual({ holder: undefined, notes: [] });
  });

  test("17 non-holding siblings: the `scan stopped` note", () => {
    for (let n = 1; n <= 17; n += 1) writeFileSync(join(dir, `sessionstart-hook-${n}.sh`), "export A=1\n");
    expect(siblingHoldingSourceLine(join(dir, "sessionstart-hook-99.sh"), line)).toEqual({
      holder: undefined,
      notes: ["sibling scan stopped after 16 files"],
    });
  });
});

describe("siblingHoldingSourceLine size caps (an I/O double)", () => {
  const line = sourceLineOf("/p/assets/grep-merge.sh") ?? "";
  const target = "/d/sessionstart-hook-3.sh";

  /** One sibling, `-6`, whose fstat reports `size` and whose reads yield `content` in chunks. */
  function io(size: number, content: Buffer): SiblingIo & { reads: number; closed: number[] } {
    let offset = 0;
    const double = {
      reads: 0,
      closed: [] as number[],
      readdirSync: (): string[] => ["sessionstart-hook-6.sh"],
      openSync: (): number => 42,
      fstatSync: (): { isFile(): boolean; size: number } => ({ isFile: () => true, size }),
      readSync: (_fd: number, buffer: Buffer, at: number, length: number): number => {
        double.reads += 1;
        const n = Math.min(length, content.length - offset, 4_096);
        content.copy(buffer, at, offset, offset + n);
        offset += n;
        return n;
      },
      closeSync: (fd: number): void => {
        double.closed.push(fd);
      },
    };
    return double;
  }

  test("fstat over the cap: ignored without a single read, descriptor closed", () => {
    const d = io(SIBLING_MAX_BYTES + 1, Buffer.from(`${line}\n`));
    expect(siblingHoldingSourceLine(target, line, d)).toEqual({
      holder: undefined,
      notes: ["sibling sessionstart-hook-6.sh ignored: over 65536 bytes"],
    });
    expect(d.reads).toBe(0);
    expect(d.closed).toEqual([42]);
  });

  test("fstat under the cap but the file grew past it while read: ignored, descriptor closed", () => {
    const grown = Buffer.concat([Buffer.from(`${line}\n`), Buffer.alloc(SIBLING_MAX_BYTES, 0x78)]);
    const d = io(100, grown);
    expect(siblingHoldingSourceLine(target, line, d)).toEqual({
      holder: undefined,
      notes: ["sibling sessionstart-hook-6.sh ignored: over 65536 bytes"],
    });
    expect(d.closed).toEqual([42]);
  });

  test("a short file read in several chunks: the holder, descriptor closed", () => {
    const text = Buffer.from(`${"#".repeat(10_000)}\n${line}\n`);
    const d = io(text.length, text);
    expect(siblingHoldingSourceLine(target, line, d)).toEqual({ holder: "sessionstart-hook-6.sh", notes: [] });
    expect(d.reads).toBeGreaterThan(1);
    expect(d.closed).toEqual([42]);
  });
});

describe("hook process with sibling hook files", () => {
  let root: string;
  let plugin: string;
  let home: string;
  let project: string;
  let d: string;
  let target: string;
  let bytes: string;
  let line: string;
  let log: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "csgm-sib-")));
    plugin = join(root, "plugin");
    for (const dir of ["hooks", "mcp", "assets"]) cpSync(join(PLUGIN, dir), join(plugin, dir), { recursive: true });
    home = join(root, "home");
    project = join(root, "project");
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify({ "code-search": ENGINE }));
    d = join(root, "session-env");
    mkdirSync(d);
    target = join(d, "sessionstart-hook-3.sh");
    log = join(root, "merge.log");
    const asset = join(plugin, "assets", "grep-merge.sh");
    bytes = envLineBytes(asset) ?? "";
    line = sourceLineOf(asset) ?? "";
    expect(bytes).not.toBe("");
    expect(line).not.toBe("");
  });

  afterEach(() => {
    if (existsSync(d)) chmodSync(d, 0o700);
    rmSync(root, { recursive: true, force: true });
  });

  async function hook(envFile = target): Promise<{ rc: number; stdout: string; stderr: string }> {
    const env: Record<string, string> = {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      HOME: home,
      CLAUDE_PROJECT_DIR: project,
      CLAUDE_ENV_FILE: envFile,
      CODE_SEARCH_MERGE_LOG: log,
    };
    const r = await capture(process.execPath, ["--env-file=/dev/null", "--config=/dev/null", join(plugin, "hooks", "grep-merge-env.ts")], {
      cwd: project,
      env,
    });
    return { rc: r.rc, stdout: r.stdout, stderr: r.stderr };
  }

  const logText = (): string => (existsSync(log) ? readFileSync(log, "utf8") : "");
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 15));
  const sib = (n: number | string): string => join(d, typeof n === "number" ? `sessionstart-hook-${n}.sh` : n);

  /** The target ends up holding exactly `bytes` after `before`. */
  function expectAppended(before = ""): void {
    expect(readFileSync(target, "utf8")).toBe(`${before}${bytes}`);
  }

  /** Row 1's outcome: target not created, sibling untouched, the "present in" log line. */
  async function expectHeldBy(holder: string, holderBytes: string | Buffer): Promise<void> {
    const before = statSync(sib(holder)).mtimeMs;
    await tick();
    expect(await hook()).toEqual(SILENT);
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(sib(holder))).toEqual(Buffer.from(holderBytes));
    expect(statSync(sib(holder)).mtimeMs).toBe(before);
    expect(logText()).toContain(`grep-merge-env: source line present in ${holder}; no line written\n`);
  }

  test("row 1: the line in sessionstart-hook-6.sh, target absent → target not created", async () => {
    writeFileSync(sib(6), bytes);
    await expectHeldBy("sessionstart-hook-6.sh", bytes);
  });

  test("row 2: foreign lines before and after the line in the sibling → the same", async () => {
    const text = `export A=1${bytes}export B=2\n`;
    writeFileSync(sib(6), text);
    await expectHeldBy("sessionstart-hook-6.sh", text);
  });

  test("row 3: target present holding `export FOO=1` → target bytes and mtime unchanged", async () => {
    writeFileSync(sib(6), bytes);
    writeFileSync(target, "export FOO=1");
    const before = statSync(target).mtimeMs;
    const siblingBefore = statSync(sib(6)).mtimeMs;
    await tick();
    expect(await hook()).toEqual(SILENT);
    expect(readFileSync(target, "utf8")).toBe("export FOO=1");
    expect(statSync(target).mtimeMs).toBe(before);
    expect(readFileSync(sib(6), "utf8")).toBe(bytes);
    expect(statSync(sib(6)).mtimeMs).toBe(siblingBefore);
    expect(logText()).toContain("grep-merge-env: source line present in sessionstart-hook-6.sh; no line written");
  });

  test("row 4: the sibling holds another asset path's line → appended", async () => {
    writeFileSync(sib(6), `${sourceLineOf("/elsewhere/assets/grep-merge.sh")}\n`);
    expect(await hook()).toEqual(SILENT);
    expectAppended();
  });

  test.each([
    ["a leading `# `", (l: string): string => `# ${l}\n`],
    ["a trailing ` # x`", (l: string): string => `${l} # x\n`],
    ["a trailing \\r", (l: string): string => `${l}\r\n`],
  ])("row 5: the line with %s in the sibling → appended", async (_name, wrap) => {
    writeFileSync(sib(6), wrap(line));
    expect(await hook()).toEqual(SILENT);
    expectAppended();
  });

  test.each(NON_MATCHING)("row 6: the line in %s → appended", async (name) => {
    writeFileSync(sib(name), bytes);
    expect(await hook()).toEqual(SILENT);
    expectAppended();
    expect(readFileSync(sib(name), "utf8")).toBe(bytes);
  });

  test("row 7: sessionstart-hook-6.sh is a symlink to a file outside D holding the line → appended", async () => {
    const outside = join(root, "outside.sh");
    writeFileSync(outside, bytes);
    symlinkSync(outside, sib(6));
    expect(await hook()).toEqual(SILENT);
    expectAppended();
    expect(logText()).toContain("grep-merge-env: sibling sessionstart-hook-6.sh ignored: ");
    expect(readFileSync(outside, "utf8")).toBe(bytes);
  });

  test.skipIf(isRoot)("row 8: the sibling holds the line with mode 000 → appended, EACCES logged", async () => {
    writeFileSync(sib(6), bytes);
    chmodSync(sib(6), 0o000);
    try {
      expect(await hook()).toEqual(SILENT);
      expectAppended();
      expect(logText()).toContain("grep-merge-env: sibling sessionstart-hook-6.sh ignored: EACCES");
    } finally {
      chmodSync(sib(6), 0o600);
    }
  });

  /** The line first, then padding to exactly `size` bytes. */
  const padded = (size: number): string => {
    const text = `${bytes}${"x".repeat(size - bytes.length)}`;
    expect(Buffer.byteLength(text)).toBe(size);
    expect(text.indexOf(line)).toBeLessThan(100);
    return text;
  };

  test("row 9: a 65,537-byte sibling holding the line early → appended, size logged", async () => {
    writeFileSync(sib(6), padded(65_537));
    expect(await hook()).toEqual(SILENT);
    expectAppended();
    expect(logText()).toContain("grep-merge-env: sibling sessionstart-hook-6.sh ignored: over 65536 bytes");
  });

  test("row 9: the same file at exactly 65,536 bytes → not appended", async () => {
    const text = padded(65_536);
    writeFileSync(sib(6), text);
    await expectHeldBy("sessionstart-hook-6.sh", text);
  });

  test("row 10: sessionstart-hook-6.sh is a directory → appended, not a regular file", async () => {
    mkdirSync(sib(6));
    expect(await hook()).toEqual(SILENT);
    expectAppended();
    expect(logText()).toContain("grep-merge-env: sibling sessionstart-hook-6.sh ignored: not a regular file");
  });

  test("row 10: sessionstart-hook-6.sh is a FIFO with no writer → appended within 5 s", async () => {
    const made = spawnSync("mkfifo", [sib(6)]);
    expect(made.status).toBe(0);
    const started = Date.now();
    expect(await hook()).toEqual(SILENT);
    expect(Date.now() - started).toBeLessThan(5_000);
    expectAppended();
    expect(logText()).toContain("grep-merge-env: sibling sessionstart-hook-6.sh ignored: not a regular file");
  }, 10_000);

  test("row 11: target -99, siblings -1…-17, the line only in -17 → appended, scan stopped", async () => {
    target = join(d, "sessionstart-hook-99.sh");
    for (let n = 1; n <= 17; n += 1) writeFileSync(sib(n), n === 17 ? bytes : "export A=1\n");
    expect(await hook()).toEqual(SILENT);
    expectAppended();
    expect(logText()).toContain("grep-merge-env: sibling scan stopped after 16 files");
  });

  test("row 11: target -99, siblings -1…-17, the line only in -16 → not appended", async () => {
    target = join(d, "sessionstart-hook-99.sh");
    for (let n = 1; n <= 17; n += 1) writeFileSync(sib(n), n === 16 ? bytes : "export A=1\n");
    await expectHeldBy("sessionstart-hook-16.sh", bytes);
    expect(logText()).not.toContain("sibling scan stopped");
  });

  test("row 12: a run with target -6, then with target -3 → exactly one line across D", async () => {
    expect(await hook(sib(6))).toEqual(SILENT);
    expect(await hook(sib(3))).toEqual(SILENT);
    expect(existsSync(sib(3))).toBe(false);
    const total = readdirSync(d).reduce((sum, name) => sum + countLine(readFileSync(join(d, name), "utf8"), line), 0);
    expect(total).toBe(1);
    expect(readFileSync(sib(6), "utf8")).toBe(bytes);
  });

  test.skipIf(isRoot)("row 13: D has mode 0300 (no listing) → appended, cannot list logged", async () => {
    chmodSync(d, 0o300);
    try {
      expect(await hook()).toEqual(SILENT);
    } finally {
      chmodSync(d, 0o700);
    }
    expectAppended();
    expect(logText()).toContain(`grep-merge-env: cannot list ${d}: EACCES`);
  });

  test("row 14: target under a missing directory → cannot append ENOENT, no cannot list", async () => {
    const missing = join(root, "no", "such", "sessionstart-hook-3.sh");
    expect(await hook(missing)).toEqual(SILENT);
    expect(logText()).toContain(`grep-merge-env: cannot append to ${missing}: ENOENT`);
    expect(logText()).not.toContain("cannot list");
  });

  test("row 15: invalid UTF-8 in the sibling, no source line → appended, no failure logged", async () => {
    writeFileSync(sib(6), Buffer.from([0xff, 0xfe, 0x0a, 0x41, 0x0a]));
    expect(await hook()).toEqual(SILENT);
    expectAppended();
    expect(logText()).not.toContain("failed:");
  });

  test("row 16: invalid UTF-8 bytes, then the line on its own line → not appended", async () => {
    const content = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(bytes)]);
    writeFileSync(sib(6), content);
    await expectHeldBy("sessionstart-hook-6.sh", content);
    expect(logText()).not.toContain("failed:");
  });

  test("an ignored sibling before the holder: both log lines, target not created", async () => {
    const outside = join(root, "outside.sh");
    writeFileSync(outside, bytes);
    symlinkSync(outside, sib(2));
    writeFileSync(sib(6), bytes);
    await expectHeldBy("sessionstart-hook-6.sh", bytes);
    const lines = logText().split("\n");
    expect(lines.some((l) => l.startsWith("grep-merge-env: sibling sessionstart-hook-2.sh ignored: "))).toBe(true);
  });

  test("CODE_SEARCH_MERGE_LOG names a FIFO with no reader: the hook does not block", async () => {
    log = join(root, "merge.fifo");
    expect(spawnSync("mkfifo", [log]).status).toBe(0);
    symlinkSync(join(root, "missing"), sib(6)); // a note to write
    const started = Date.now();
    expect(await hook()).toEqual(SILENT);
    expect(Date.now() - started).toBeLessThan(3_000);
    expectAppended();
  }, 10_000);

  test("the target holds the line itself: nothing written and nothing logged", async () => {
    writeFileSync(target, bytes);
    writeFileSync(sib(6), bytes);
    expect(await hook()).toEqual(SILENT);
    expect(readFileSync(target, "utf8")).toBe(bytes);
    expect(logText()).toBe("");
  });
});
