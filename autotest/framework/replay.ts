#!/usr/bin/env bun
/**
 * replay.ts - Turn-by-turn conversation replay for debugging test results.
 *
 * Reads a test's transcript.jsonl and debug.log to reconstruct the conversation
 * with timing, token usage, and tool call details per turn.
 *
 * Usage:
 *   bun run replay.ts <test-dir> [OPTIONS]
 *   bun run replay.ts --results-dir <run-dir> --test <id> --model <slug> [OPTIONS]
 *
 * Options:
 *   --turn <N>          Start at specific turn (default: 1)
 *   --interactive       Interactive step-through mode
 *   --export <path>     Export conversation to a single file
 *   --format <json|text>  Output format (default: text)
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "fs";
import { join } from "path";
import { parseArgs } from "util";
import { createInterface } from "readline";
import type { ReplayTurn } from "./types.js";
import {
  parseTranscriptFile,
  buildReplayTurns,
} from "./parsers/transcript-parser.js";

// --- Helpers ---

function readJson(path: string): any {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

// --- Formatting ---

function formatTurnText(turn: ReplayTurn): string {
  const lines: string[] = [];

  if (turn.type === "session_start") {
    lines.push(`--- Session Start (id: ${turn.session_id ?? "?"}) ---`);
    return lines.join("\n");
  }

  if (turn.type === "session_end") {
    lines.push("--- Session End ---");
    return lines.join("\n");
  }

  if (turn.type === "tool_result") {
    const result = turn.result ?? "";
    if (result) {
      lines.push(`  [Tool Result for ${turn.tool_id ?? "?"}]`);
      const resultLines = String(result).split("\n");
      for (const rl of resultLines.slice(0, 5)) lines.push(`    ${rl}`);
      if (resultLines.length > 5)
        lines.push(`    ... (${resultLines.length - 5} more lines)`);
    }
    return lines.join("\n");
  }

  if (turn.type === "error") {
    lines.push(`  [ERROR] ${turn.content ?? ""}`);
    return lines.join("\n");
  }

  // Assistant turn
  lines.push(`=== Turn ${turn.turn_number} ===`);

  const mt = turn.metrics;
  if (mt) {
    const parts: string[] = [];
    if (mt.duration_ms) parts.push(`${mt.duration_ms}ms`);
    if (mt.tokens) parts.push(`${mt.tokens.total ?? "?"} tokens`);
    if (mt.retry) parts.push("RETRY");
    if (parts.length > 0) lines.push(`  [${parts.join(" | ")}]`);
  }

  const text = (turn.text ?? "").trim();
  if (text) {
    const textLines = text.split("\n");
    for (const tl of textLines.slice(0, 20)) lines.push(`  ${tl}`);
    if (textLines.length > 20)
      lines.push(`  ... (${textLines.length - 20} more lines)`);
  }

  for (const tc of turn.tool_calls ?? []) {
    const name = tc.name ?? "?";
    const input = tc.input ?? {};

    if (name === "Task") {
      const agent = input.subagent_type ?? "?";
      const desc = input.description ?? "";
      lines.push(`  >> Task(${agent}) - ${desc}`);
      const prompt = input.prompt ?? "";
      if (prompt) lines.push(`     prompt: ${prompt.slice(0, 120)}...`);
    } else if (name === "Skill") {
      lines.push(`  >> Skill(${input.skill ?? "?"})`);
    } else if (["Read", "Write", "Edit", "Glob", "Grep"].includes(name)) {
      const path = input.file_path ?? input.path ?? input.pattern ?? "";
      lines.push(`  >> ${name}(${path})`);
    } else if (name === "Bash") {
      lines.push(`  >> Bash(${(input.command ?? "").slice(0, 100)})`);
    } else {
      let inputStr = JSON.stringify(input);
      if (inputStr.length > 120) inputStr = inputStr.slice(0, 120) + "...";
      lines.push(`  >> ${name}(${inputStr})`);
    }
  }

  return lines.join("\n");
}

function formatReplayText(meta: any, turns: ReplayTurn[], metrics: any): string {
  const lines: string[] = [];

  lines.push("=".repeat(60));
  lines.push("  CONVERSATION REPLAY");
  lines.push("=".repeat(60));

  if (meta) {
    lines.push(`  Test:     ${meta.test_id ?? "?"}`);
    lines.push(`  Model:    ${meta.model ?? "?"}`);
    lines.push(`  Duration: ${meta.duration_seconds ?? "?"}s`);
    lines.push(`  Exit:     ${meta.exit_code ?? "?"}`);
  }

  if (metrics) {
    const totals = metrics.totals ?? {};
    lines.push(`  Turns:    ${totals.total_turns ?? "?"}`);
    lines.push(`  Retries:  ${totals.total_retries ?? "?"}`);
    const tok = totals.total_tokens ?? {};
    lines.push(
      `  Tokens:   ${tok.total ?? "?"} (p=${tok.prompt ?? "?"}, c=${tok.completion ?? "?"})`
    );
    const cost = totals.cost_usd;
    lines.push(`  Cost:     ${cost != null ? "$" + cost : "N/A"}`);
    lines.push(
      `  Tools:    ${(totals.unique_tools ?? []).join(", ")}`
    );
  }

  lines.push("=".repeat(60));
  lines.push("");

  for (const turn of turns) {
    lines.push(formatTurnText(turn));
    lines.push("");
  }

  lines.push("=".repeat(60));
  return lines.join("\n");
}

function formatReplayJson(meta: any, turns: ReplayTurn[], metrics: any): string {
  return JSON.stringify(
    {
      meta,
      metrics_summary: metrics?.totals ?? null,
      turns,
    },
    null,
    2
  );
}

// --- Interactive replay ---

async function interactiveReplay(
  meta: any,
  turns: ReplayTurn[],
  metrics: any,
  startTurn: number
) {
  console.log("=".repeat(60));
  console.log("  INTERACTIVE REPLAY");
  console.log("  Press Enter to advance, 'q' to quit, 'j' for JSON");
  console.log("=".repeat(60));

  if (meta) {
    console.log(
      `  Test:  ${meta.test_id ?? "?"} | Model: ${meta.model ?? "?"}`
    );
  }
  console.log();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const prompt = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  for (const turn of turns) {
    if (
      turn.turn_number < startTurn &&
      turn.type !== "session_start"
    )
      continue;

    console.log(formatTurnText(turn));
    console.log();

    if (turn.type === "assistant") {
      const cmd = (
        await prompt("[Enter=next, q=quit, j=json] ")
      )
        .trim()
        .toLowerCase();
      if (cmd === "q") {
        console.log("Replay ended.");
        rl.close();
        return;
      }
      if (cmd === "j") {
        console.log(JSON.stringify(turn, null, 2));
        console.log();
      }
    }
  }

  rl.close();
}

// --- Find test directory ---

function findTestDir(
  resultsDir: string,
  testId: string,
  modelSlug: string
): string | null {
  // Direct match
  const direct = join(resultsDir, modelSlug, testId);
  if (existsSync(direct)) return direct;

  // Partial match on model directory
  if (!existsSync(resultsDir)) return null;
  for (const name of readdirSync(resultsDir)) {
    const modelDir = join(resultsDir, name);
    if (!statSync(modelDir).isDirectory()) continue;
    const testDir = join(modelDir, testId);
    if (existsSync(testDir) && name.includes(modelSlug)) {
      return testDir;
    }
  }

  return null;
}

// --- CLI ---

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "results-dir": { type: "string" },
    test: { type: "string" },
    model: { type: "string" },
    turn: { type: "string", default: "1" },
    interactive: { type: "boolean", default: false },
    export: { type: "string" },
    format: { type: "string", short: "f", default: "text" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(
    "Usage: bun run replay.ts <test-dir> [--turn N] [--interactive] [--export path] [--format json|text]"
  );
  console.log(
    "       bun run replay.ts --results-dir <dir> --test <id> --model <slug>"
  );
  process.exit(0);
}

// Resolve test directory
let testDir: string;

if (positionals.length > 0) {
  testDir = positionals[0];
} else if (values["results-dir"] && values.test) {
  const model = values.model ?? "monitor";
  const found = findTestDir(values["results-dir"], values.test, model);
  if (!found) {
    console.error(
      `ERROR: Could not find test '${values.test}' for model '${model}' in ${values["results-dir"]}`
    );
    process.exit(1);
  }
  testDir = found;
} else {
  console.error(
    "ERROR: Provide either test_dir or --results-dir with --test"
  );
  process.exit(1);
}

if (!existsSync(testDir)) {
  console.error(`ERROR: Directory not found: ${testDir}`);
  process.exit(1);
}

const transcriptPath = join(testDir, "transcript.jsonl");
if (!existsSync(transcriptPath)) {
  console.error(`ERROR: transcript.jsonl not found in ${testDir}`);
  process.exit(1);
}

const entries = parseTranscriptFile(transcriptPath);
const metrics = readJson(join(testDir, "metrics.json"));
const meta = readJson(join(testDir, "meta.json"));
const turns = buildReplayTurns(entries, metrics);
const startTurn = parseInt(values.turn ?? "1", 10);

if (values.interactive) {
  await interactiveReplay(meta, turns, metrics, startTurn);
} else {
  const output =
    values.format === "json"
      ? formatReplayJson(meta, turns, metrics)
      : formatReplayText(meta, turns, metrics);

  if (values.export) {
    writeFileSync(values.export, output + "\n");
    console.log(`Exported to ${values.export}`);
  } else {
    console.log(output);
  }
}
