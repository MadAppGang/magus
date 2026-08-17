#!/usr/bin/env bun
/**
 * capture-builtin.ts — turn a built-in Claude Code output style into an
 * importable file on THIS machine.
 *
 * Built-in styles (Explanatory, Learning, Proactive) ship inside the Claude
 * Code binary, so `compose-style.ts` has no file to read. This captures the
 * real text instead of guessing it: a transparent proxy sits in front of the
 * Anthropic API, one `claude -p` round trip runs with the style active, and
 * the system prompt it actually sent is recorded.
 *
 * Why capture rather than grep the binary: the binary's symbol names are
 * minified and change every release, so a grep breaks silently. A capture
 * reads what the harness genuinely sent, for the exact version installed.
 *
 * Why on the user's machine rather than committed here: a snapshot in this
 * repo would be Anthropic's prompt text redistributed, and would go stale on
 * their release schedule rather than ours.
 *
 * Section boundaries are found by DIFF, not by heading. The style's own body
 * contains H1 headings of its own (Explanatory ships "# Explanatory Style
 * Active"), so splitting on the next "# " truncates it. Capturing once with
 * the style and once without isolates exactly the inserted block.
 *
 * Usage:
 *   bun capture-builtin.ts --discover          # names Anthropic ships today
 *   bun capture-builtin.ts --check             # which captures fell behind
 *   bun capture-builtin.ts --all               # capture every built-in
 *   bun capture-builtin.ts --style Explanatory # capture one
 *     [--out DIR] [--port 8899] [--timeout 180] [--dry-run]
 *
 * RE-RUN AFTER EVERY CLAUDE CODE UPGRADE. A capture records the version it
 * came from; `--check` compares that against the installed binary and reports
 * both stale files and built-ins that exist but were never captured, which is
 * how a newly introduced style gets noticed.
 *
 * Costs one real API round trip per style, plus one shared baseline.
 * Exit code: 1 on any failure, or from --check when anything is stale.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { splitFrontmatter } from "./compose-style.ts";

const UPSTREAM = "https://api.anthropic.com";

interface CaptureResult {
  system: string;
  blocks: number;
}

/**
 * Run one `claude -p` through a recording proxy and return the system prompt
 * it sent. `styleName` of null captures the baseline with no style active.
 */
async function captureSystem(
  styleName: string | null,
  port: number,
  timeoutMs: number,
): Promise<CaptureResult> {
  const project = mkdtempSync(join(tmpdir(), "style-capture-"));
  mkdirSync(join(project, ".claude"), { recursive: true });
  writeFileSync(
    join(project, ".claude", "settings.json"),
    `${JSON.stringify(styleName ? { outputStyle: styleName } : {}, null, 2)}\n`,
    "utf8",
  );

  let captured: unknown = null;

  const server = Bun.serve({
    port,
    idleTimeout: 240,
    async fetch(req) {
      const url = new URL(req.url);
      const body =
        req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();

      if (body && captured === null) {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(body)) as { system?: unknown };
          if (parsed.system) captured = parsed.system;
        } catch {
          // Not JSON. Forward it regardless — recording is best effort.
        }
      }

      const headers = new Headers(req.headers);
      headers.set("host", new URL(UPSTREAM).host);
      headers.delete("content-length");
      // fetch() transparently decompresses, so forwarding the upstream
      // content-encoding would tell the client to decompress plaintext.
      // Ask for identity and drop the header on the way back.
      headers.set("accept-encoding", "identity");

      const upstream = await fetch(`${UPSTREAM}${url.pathname}${url.search}`, {
        method: req.method,
        headers,
        body,
      });
      const out = new Headers(upstream.headers);
      out.delete("content-encoding");
      out.delete("content-length");
      return new Response(upstream.body, { status: upstream.status, headers: out });
    },
  });

  try {
    const proc = Bun.spawn(["claude", "-p", "reply with the single word ok"], {
      cwd: project,
      env: { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` },
      stdout: "pipe",
      stderr: "pipe",
    });

    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const exitCode = await proc.exited;
    clearTimeout(timer);

    if (captured === null) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(
        `no system prompt captured (claude exited ${exitCode}). ${stderr.trim().slice(0, 300)}`,
      );
    }
  } finally {
    server.stop(true);
    rmSync(project, { recursive: true, force: true });
  }

  const blocks = Array.isArray(captured) ? captured : [captured];
  const system = blocks
    .map((block) =>
      typeof block === "string" ? block : String((block as { text?: string })?.text ?? ""),
    )
    .join("\n");

  return { system, blocks: blocks.length };
}

/**
 * The inserted block is what the styled capture has and the baseline does not.
 *
 * Given baseline = A + B and styled = A + X + B, the end of X is fixed by
 * ARITHMETIC, not by walking back from the end. A common-suffix walk keeps
 * going whenever X's last characters happen to match B's last characters, and
 * it does happen: the first version of this truncated Explanatory mid-sentence
 * at "general programming concepts", eating the closing two sentences.
 */
/**
 * Extract the section beginning at `marker` from `styled`.
 *
 * The end is found by heading, with `baseline` deciding which headings are
 * STRUCTURAL. Splitting naively on the next `# ` truncates, because a style's
 * own body contains H1s (Explanatory ships "# Explanatory Style Active"); but
 * a heading that also appears in the baseline belongs to the harness, so it
 * marks the real boundary.
 *
 * Character-level diffing was tried first and abandoned. If styled = A + X + B
 * and baseline = A + B, the split is genuinely ambiguous whenever X starts or
 * ends the way the surrounding text does — every rotation of X satisfies the
 * length constraint. All three variants failed on real captures: a suffix walk
 * cut Explanatory mid-sentence at "general programming concepts", a prefix
 * walk slid past the marker entirely, and smallest-valid-split returned
 * "D\nINSERTE" for "INSERTED\n".
 *
 * Residual limitation: a style whose body contains an H1 that also appears in
 * the baseline would be cut there. None of the three built-ins does.
 */
export function extractSection(baseline: string, styled: string, marker: string): string {
  const start = styled.indexOf(marker);
  if (start === -1) return "";

  const structural = new Set(
    baseline
      .split("\n")
      .filter((line) => line.startsWith("# "))
      .map((line) => line.trimEnd()),
  );

  const lines = styled.slice(start).split("\n");
  const out: string[] = [lines[0]];
  for (const line of lines.slice(1)) {
    if (line.startsWith("# ") && structural.has(line.trimEnd())) break;
    out.push(line);
  }
  return out.join("\n").trimEnd();
}

/** Strip the harness's own `# Output Style: <name>` header off the block. */
export function stripSectionHeader(block: string, styleName: string): string {
  const marker = `# Output Style: ${styleName}`;
  const at = block.indexOf(marker);
  if (at === -1) return block.trim();
  return block.slice(at + marker.length).trim();
}

export function slugFor(styleName: string): string {
  return `builtin-${styleName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function toStyleFile(styleName: string, body: string, version: string): string {
  return [
    "---",
    `name: ${slugFor(styleName)}`,
    `description: "Captured built-in output style: ${styleName}"`,
    // Our composed file sets this itself; setting it here too means the file
    // is also safe to activate directly.
    "keep-coding-instructions: true",
    // Machine-readable so --check can tell when Claude Code moved on. Keep it
    // a bare version: --check compares it, a human sentence would not parse.
    `captured-from: ${version}`,
    `captured-style: ${styleName}`,
    'generated-by: "capture-builtin.ts. Re-run after a Claude Code upgrade."',
    "---",
    "",
    body,
    "",
  ].join("\n");
}

/** "2.1.233 (Claude Code)" -> "2.1.233". --check compares these. */
export function normalizeVersion(raw: string): string {
  return /(\d+\.\d+\.\d+)/.exec(raw)?.[1] ?? raw.trim() ?? "unknown";
}

async function run(cmd: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
    await proc.exited;
    return (await new Response(proc.stdout).text()).trim();
  } catch {
    return "";
  }
}

async function claudeVersion(): Promise<string> {
  return normalizeVersion(await run(["claude", "--version"])) || "unknown";
}

/**
 * Names of the built-in styles, read out of the installed binary.
 *
 * This is the one place a minified-bundle grep is acceptable: it recovers
 * NAMES, which are cheap to verify by eye against `/output-style` and
 * harmless to get wrong. The prompt TEXT is never read this way — that is
 * what the capture is for. If a future release changes the shape and this
 * returns nothing, read the names off the `/output-style` picker and pass
 * `--style` directly.
 */
export async function discoverBuiltins(): Promise<string[]> {
  const binary = await run(["sh", "-c", "readlink -f \"$(command -v claude)\" 2>/dev/null || command -v claude"]);
  if (!binary) return [];
  const out = await run([
    "grep",
    "-o",
    "-a",
    "-E",
    'name:"[A-Za-z0-9 -]+",source:"built-in"',
    binary,
  ]);
  const names = new Set<string>();
  for (const line of out.split("\n")) {
    const match = /name:"([^"]+)"/.exec(line);
    if (match) names.add(match[1]);
  }
  return [...names].sort();
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      style: { type: "string" },
      all: { type: "boolean", default: false },
      discover: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      out: { type: "string" },
      port: { type: "string", default: "8899" },
      timeout: { type: "string", default: "180" },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const port = Number(values.port);
  const timeoutMs = Number(values.timeout) * 1000;
  const outDir = values.out ?? join(homedir(), ".claude", "output-styles");
  const version = await claudeVersion();

  if (values.discover) {
    const names = await discoverBuiltins();
    if (names.length === 0) {
      console.error(
        "Could not read the built-in names from the binary. Open /output-style and\n" +
          "pass the names you see with --style.",
      );
      return 1;
    }
    console.log(`Built-in output styles in Claude Code ${version}:`);
    for (const name of names) console.log(`  ${name}`);
    return 0;
  }

  if (values.check) {
    const captured = existsSync(outDir)
      ? readdirSync(outDir).filter((f) => f.startsWith("builtin-") && f.endsWith(".md"))
      : [];
    const known = await discoverBuiltins();

    console.log(`Claude Code ${version}`);
    console.log("════════════════════════════════════════");
    let stale = 0;
    for (const file of captured.sort()) {
      const { frontmatter } = splitFrontmatter(readFileSync(join(outDir, file), "utf8"));
      const from = frontmatter["captured-from"] ?? "unknown";
      const ok = from === version;
      if (!ok) stale++;
      console.log(`  ${ok ? "current" : "STALE  "}  ${file}  (captured from ${from})`);
    }
    const missing = known.filter((name) => !captured.includes(`${slugFor(name)}.md`));
    for (const name of missing) console.log(`  MISSING  ${name}`);
    console.log("════════════════════════════════════════");
    if (stale > 0 || missing.length > 0) {
      console.log("Re-capture with:  bun capture-builtin.ts --all");
      return 1;
    }
    console.log("All built-ins captured at the current version.");
    return 0;
  }

  let targets: string[];
  if (values.all) {
    targets = await discoverBuiltins();
    if (targets.length === 0) {
      console.error("error: --all found no built-in names. Use --style with an explicit name.");
      return 1;
    }
  } else if (values.style) {
    targets = [values.style];
  } else {
    console.error(
      "error: pass --style <name>, or --all, or --discover to list what exists.",
    );
    return 1;
  }

  // One baseline serves every style — it is the same prompt minus the section.
  console.error(`[capture] baseline (no output style) …`);
  const baseline = await captureSystem(null, port, timeoutMs);
  console.error(`[capture] baseline: ${baseline.system.length} chars, ${baseline.blocks} blocks`);

  let failures = 0;
  for (const [index, styleName] of targets.entries()) {
    console.error(`[capture] with ${styleName} …`);
    const styled = await captureSystem(styleName, port + 1 + index, timeoutMs);

    const marker = `# Output Style: ${styleName}`;
    const section = extractSection(baseline.system, styled.system, marker);
    if (!section) {
      console.error(
        styled.system.includes(marker)
          ? `error: ${styleName}: found the marker but not where the section ends.`
          : `error: ${styleName}: "${marker}" is not in the captured prompt. Real built-in?`,
      );
      failures++;
      continue;
    }

    const body = stripSectionHeader(section, styleName);
    const file = toStyleFile(styleName, body, version);
    const path = join(outDir, `${slugFor(styleName)}.md`);

    if (values["dry-run"]) {
      console.log(`--- ${path}`);
      console.log(file);
      continue;
    }

    mkdirSync(outDir, { recursive: true });
    writeFileSync(path, file, "utf8");
    console.log(
      `captured  ${styleName.padEnd(14)} ${body.length} chars  ->  --import user:${slugFor(styleName)}`,
    );
  }

  if (!values["dry-run"] && failures === 0) {
    console.log(`\nAll captures are from Claude Code ${version}. Re-run after an upgrade;`);
    console.log(`"bun capture-builtin.ts --check" reports when they fall behind.`);
  }
  return failures > 0 ? 1 : 0;
}

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
