#!/usr/bin/env bun
/**
 * analyze-results.ts - Tech-Writer Benchmark Score Analyzer
 *
 * Parses judge transcripts from the tech-writer comparison benchmark,
 * extracts JSON scores, de-blinds through sample-mapping.json, and
 * produces a weighted comparison report.
 *
 * Usage:
 *   bun ./autotest/tech-writer/analyze-results.ts <results-dir>
 *
 * The results-dir must contain:
 *   - sample-mapping.json (A/B → default/techwriter mapping)
 *   - test-cases.json (criteria weights)
 *   - judge/<id>/response.txt or judge/<id>/transcript.jsonl
 *
 * Outputs:
 *   <results-dir>/report/tech-writer-benchmark.json
 *   <results-dir>/report/tech-writer-benchmark.md
 *   stdout — human-readable summary
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { TranscriptEntry } from "../framework/types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Criterion {
  id: string;
  name: string;
  weight: number;
  description: string;
}

interface SampleMapping {
  coin_flip: number;
  sample_a: string; // "default" or "techwriter"
  sample_b: string;
  created_at: string;
}

interface JudgeScores {
  sample_a: Record<string, number>;
  sample_b: Record<string, number>;
}

interface JudgeResult {
  judge_id: string;
  model: string;
  scores: JudgeScores;
  preference: string; // "A" or "B"
  reasoning: string;
  parse_method: string; // "json" | "fenced_json" | "regex" | "failed"
  raw_response_length: number;
}

interface DeblindedScores {
  default: Record<string, number>;
  techwriter: Record<string, number>;
}

interface CriterionStats {
  criterion_id: string;
  criterion_name: string;
  weight: number;
  default_scores: number[];
  techwriter_scores: number[];
  default_mean: number;
  techwriter_mean: number;
  default_stddev: number;
  techwriter_stddev: number;
  default_min: number;
  default_max: number;
  techwriter_min: number;
  techwriter_max: number;
  winner: string;
  delta: number;
}

interface BenchmarkReport {
  run_dir: string;
  analyzed_at: string;
  topic: string;
  sample_mapping: SampleMapping;
  total_judges: number;
  successful_judges: number;
  failed_judges: string[];
  criteria_results: CriterionStats[];
  weighted_scores: {
    default: number;
    techwriter: number;
    winner: string;
    delta: number;
  };
  preference_votes: {
    default: number;
    techwriter: number;
    total: number;
    consensus_pct: number;
    winner: string;
  };
  judge_details: JudgeResult[];
}

// ---------------------------------------------------------------------------
// ANSI colors
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function c(text: string, color: string): string {
  return `${color}${text}${RESET}`;
}

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

// ---------------------------------------------------------------------------
// Score extraction from judge responses
// ---------------------------------------------------------------------------

/**
 * Clamp a score to the valid range [1, 10].
 */
function clamp(score: number): number {
  if (!Number.isFinite(score)) return 5; // default for NaN/Infinity
  return Math.max(1, Math.min(10, Math.round(score)));
}

/**
 * Try to parse judge scores from raw text response.
 * Attempts multiple strategies:
 *   1. Direct JSON parse
 *   2. Extract from markdown code fences
 *   3. Regex extraction as last resort
 */
function extractScores(text: string): { scores: JudgeScores; preference: string; reasoning: string; method: string } | null {
  // Strategy 1: Direct JSON parse
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed.scores?.sample_a && parsed.scores?.sample_b) {
      return {
        scores: parsed.scores,
        preference: (parsed.preference || "").toString().toUpperCase().trim(),
        reasoning: (parsed.reasoning || "").toString(),
        method: "json",
      };
    }
  } catch {
    // Not raw JSON, try next strategy
  }

  // Strategy 2: Extract from markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (parsed.scores?.sample_a && parsed.scores?.sample_b) {
        return {
          scores: parsed.scores,
          preference: (parsed.preference || "").toString().toUpperCase().trim(),
          reasoning: (parsed.reasoning || "").toString(),
          method: "fenced_json",
        };
      }
    } catch {
      // Fenced content not valid JSON
    }
  }

  // Strategy 3: Find any JSON object in the text
  const jsonMatch = text.match(/\{[\s\S]*"scores"[\s\S]*"sample_a"[\s\S]*"sample_b"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.scores?.sample_a && parsed.scores?.sample_b) {
        return {
          scores: parsed.scores,
          preference: (parsed.preference || "").toString().toUpperCase().trim(),
          reasoning: (parsed.reasoning || "").toString(),
          method: "regex",
        };
      }
    } catch {
      // Regex-extracted content not valid JSON
    }
  }

  return null;
}

/**
 * Extract the final text response from a transcript.jsonl file.
 */
function extractFromTranscript(transcriptPath: string): string {
  const content = readFileSync(transcriptPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  // Try "result" type first (claudish --json format)
  for (const line of lines) {
    try {
      const entry: TranscriptEntry = JSON.parse(line);
      if (entry.type === "result" && typeof entry.result === "string" && entry.result.length > 50) {
        return entry.result;
      }
    } catch {
      continue;
    }
  }

  // Fallback: last assistant text
  let lastText = "";
  for (const line of lines) {
    try {
      const entry: TranscriptEntry = JSON.parse(line);
      if (entry.type === "assistant" && entry.message?.content) {
        const texts = entry.message.content
          .filter((b) => b.type === "text" && b.text)
          .map((b) => b.text!)
          .join("\n");
        if (texts) lastText = texts;
      }
    } catch {
      continue;
    }
  }

  return lastText;
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: bun analyze-results.ts <results-dir>");
    process.exit(1);
  }

  const resultsDir = args[0];

  // Load required files
  const mappingPath = join(resultsDir, "sample-mapping.json");
  const configPath = join(resultsDir, "test-cases.json");

  if (!existsSync(mappingPath)) {
    console.error(`ERROR: sample-mapping.json not found in ${resultsDir}`);
    process.exit(1);
  }
  if (!existsSync(configPath)) {
    console.error(`ERROR: test-cases.json not found in ${resultsDir}`);
    process.exit(1);
  }

  const mapping: SampleMapping = JSON.parse(readFileSync(mappingPath, "utf-8"));
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  const criteria: Criterion[] = config.evaluation.criteria;
  const criteriaIds = criteria.map((c) => c.id);
  const totalWeight: number = config.evaluation.total_weight;
  const judgeConfigs: Array<{ id: string; model: string }> = config.judges;

  console.log(`\n${c("=== Tech-Writer Benchmark Analyzer ===", BOLD)}`);
  console.log(`Results dir: ${resultsDir}`);
  console.log(`Mapping:     Sample A = ${mapping.sample_a}, Sample B = ${mapping.sample_b}`);
  console.log(`Criteria:    ${criteria.length}`);
  console.log(`Judges:      ${judgeConfigs.length}`);
  console.log("");

  // Process each judge
  const judgeResults: JudgeResult[] = [];
  const failedJudges: string[] = [];

  for (const judge of judgeConfigs) {
    const judgeDir = join(resultsDir, "judge", judge.id);

    // Try response.txt first, then transcript.jsonl
    let rawText = "";
    const responsePath = join(judgeDir, "response.txt");
    const transcriptPath = join(judgeDir, "transcript.jsonl");

    if (existsSync(responsePath)) {
      rawText = readFileSync(responsePath, "utf-8");
    } else if (existsSync(transcriptPath)) {
      rawText = extractFromTranscript(transcriptPath);
    }

    if (!rawText || rawText.length < 20) {
      console.log(`  ${c("SKIP", YELLOW)} ${judge.id}: no response found`);
      failedJudges.push(judge.id);
      continue;
    }

    const extracted = extractScores(rawText);
    if (!extracted) {
      console.log(`  ${c("FAIL", RED)} ${judge.id}: could not parse scores (${rawText.length} chars)`);
      failedJudges.push(judge.id);
      continue;
    }

    // Validate and clamp scores
    const clampedScores: JudgeScores = {
      sample_a: {},
      sample_b: {},
    };

    for (const cid of criteriaIds) {
      clampedScores.sample_a[cid] = clamp(extracted.scores.sample_a[cid] ?? 5);
      clampedScores.sample_b[cid] = clamp(extracted.scores.sample_b[cid] ?? 5);
    }

    // Normalize preference
    let pref = extracted.preference;
    if (pref !== "A" && pref !== "B") {
      // Try to infer from reasoning
      if (extracted.reasoning.toLowerCase().includes("sample a")) pref = "A";
      else if (extracted.reasoning.toLowerCase().includes("sample b")) pref = "B";
      else pref = "A"; // default fallback
    }

    judgeResults.push({
      judge_id: judge.id,
      model: judge.model,
      scores: clampedScores,
      preference: pref,
      reasoning: extracted.reasoning.slice(0, 500),
      parse_method: extracted.method,
      raw_response_length: rawText.length,
    });

    console.log(`  ${c("OK  ", GREEN)} ${judge.id}: parsed via ${extracted.method} (pref=${pref})`);
  }

  console.log("");

  if (judgeResults.length === 0) {
    console.error("ERROR: No judges produced parseable results.");
    process.exit(1);
  }

  // De-blind scores: map A/B → default/techwriter
  function deblind(result: JudgeResult): DeblindedScores {
    const scores: DeblindedScores = { default: {}, techwriter: {} };
    for (const cid of criteriaIds) {
      if (mapping.sample_a === "default") {
        scores.default[cid] = result.scores.sample_a[cid];
        scores.techwriter[cid] = result.scores.sample_b[cid];
      } else {
        scores.default[cid] = result.scores.sample_b[cid];
        scores.techwriter[cid] = result.scores.sample_a[cid];
      }
    }
    return scores;
  }

  // Compute per-criterion statistics
  const criteriaResults: CriterionStats[] = criteria.map((criterion) => {
    const defaultScores = judgeResults.map((j) => deblind(j).default[criterion.id]);
    const techwriterScores = judgeResults.map((j) => deblind(j).techwriter[criterion.id]);

    const defaultMean = mean(defaultScores);
    const techwriterMean = mean(techwriterScores);
    const delta = techwriterMean - defaultMean;

    return {
      criterion_id: criterion.id,
      criterion_name: criterion.name,
      weight: criterion.weight,
      default_scores: defaultScores,
      techwriter_scores: techwriterScores,
      default_mean: Math.round(defaultMean * 10) / 10,
      techwriter_mean: Math.round(techwriterMean * 10) / 10,
      default_stddev: Math.round(stddev(defaultScores) * 10) / 10,
      techwriter_stddev: Math.round(stddev(techwriterScores) * 10) / 10,
      default_min: Math.min(...defaultScores),
      default_max: Math.max(...defaultScores),
      techwriter_min: Math.min(...techwriterScores),
      techwriter_max: Math.max(...techwriterScores),
      winner: delta > 0.1 ? "techwriter" : delta < -0.1 ? "default" : "tie",
      delta: Math.round(delta * 10) / 10,
    };
  });

  // Compute weighted overall scores
  let defaultWeighted = 0;
  let techwriterWeighted = 0;
  for (const cr of criteriaResults) {
    defaultWeighted += cr.default_mean * cr.weight;
    techwriterWeighted += cr.techwriter_mean * cr.weight;
  }
  defaultWeighted = Math.round((defaultWeighted / totalWeight) * 10) / 10;
  techwriterWeighted = Math.round((techwriterWeighted / totalWeight) * 10) / 10;

  const overallDelta = Math.round((techwriterWeighted - defaultWeighted) * 10) / 10;
  const overallWinner = overallDelta > 0.1 ? "techwriter" : overallDelta < -0.1 ? "default" : "tie";

  // Count preference votes (de-blinded)
  let defaultVotes = 0;
  let techwriterVotes = 0;
  for (const j of judgeResults) {
    const prefApproach =
      j.preference === "A" ? mapping.sample_a : mapping.sample_b;
    if (prefApproach === "default") defaultVotes++;
    else techwriterVotes++;
  }

  const totalVotes = judgeResults.length;
  const maxVotes = Math.max(defaultVotes, techwriterVotes);
  const consensusPct = Math.round((maxVotes / totalVotes) * 100);
  const prefWinner = defaultVotes > techwriterVotes ? "default" : techwriterVotes > defaultVotes ? "techwriter" : "tie";

  // --- Console output ---

  console.log(c("=== Per-Criterion Results ===", BOLD));
  console.log("");
  console.log(
    `  ${c(pad("Criterion", 22), BOLD)} ${c(pad("Weight", 8), DIM)} ` +
    `${pad("Default", 10)} ${pad("TechWriter", 12)} ${pad("Winner", 12)} ${pad("Delta", 8)}`
  );
  console.log("  " + "─".repeat(76));

  for (const cr of criteriaResults) {
    const winnerColor = cr.winner === "techwriter" ? GREEN : cr.winner === "default" ? RED : YELLOW;
    const deltaStr = cr.delta >= 0 ? `+${cr.delta}` : `${cr.delta}`;
    console.log(
      `  ${pad(cr.criterion_name, 22)} ${c(pad(`${cr.weight}x`, 8), DIM)} ` +
      `${pad(String(cr.default_mean), 10)} ${pad(String(cr.techwriter_mean), 12)} ` +
      `${c(pad(cr.winner, 12), winnerColor)} ${c(deltaStr, winnerColor)}`
    );
  }

  console.log("  " + "─".repeat(76));

  const overallColor = overallWinner === "techwriter" ? GREEN : overallWinner === "default" ? RED : YELLOW;
  const overallDeltaStr = overallDelta >= 0 ? `+${overallDelta}` : `${overallDelta}`;
  console.log(
    `  ${c(pad("WEIGHTED OVERALL", 22), BOLD)} ${c(pad("12.0x", 8), DIM)} ` +
    `${pad(String(defaultWeighted), 10)} ${pad(String(techwriterWeighted), 12)} ` +
    `${c(pad(overallWinner.toUpperCase(), 12), overallColor)} ${c(overallDeltaStr, overallColor)}`
  );

  console.log("");
  console.log(c("=== Preference Votes ===", BOLD));
  console.log(`  Default:     ${defaultVotes}/${totalVotes}`);
  console.log(`  Tech-Writer: ${techwriterVotes}/${totalVotes}`);
  console.log(`  Consensus:   ${consensusPct}%`);
  console.log(`  Winner:      ${c(prefWinner.toUpperCase(), prefWinner === "techwriter" ? GREEN : prefWinner === "default" ? RED : YELLOW)}`);
  console.log("");

  // --- Build report ---

  const report: BenchmarkReport = {
    run_dir: resultsDir,
    analyzed_at: new Date().toISOString(),
    topic: config.topic.title,
    sample_mapping: mapping,
    total_judges: judgeConfigs.length,
    successful_judges: judgeResults.length,
    failed_judges: failedJudges,
    criteria_results: criteriaResults,
    weighted_scores: {
      default: defaultWeighted,
      techwriter: techwriterWeighted,
      winner: overallWinner,
      delta: overallDelta,
    },
    preference_votes: {
      default: defaultVotes,
      techwriter: techwriterVotes,
      total: totalVotes,
      consensus_pct: consensusPct,
      winner: prefWinner,
    },
    judge_details: judgeResults,
  };

  // Write JSON report
  const reportDir = join(resultsDir, "report");
  mkdirSync(reportDir, { recursive: true });

  const jsonPath = join(reportDir, "tech-writer-benchmark.json");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`JSON report: ${jsonPath}`);

  // Write Markdown report
  const mdPath = join(reportDir, "tech-writer-benchmark.md");
  const md = generateMarkdownReport(report);
  writeFileSync(mdPath, md);
  console.log(`MD report:   ${mdPath}`);
  console.log("");
}

// ---------------------------------------------------------------------------
// Markdown report generator
// ---------------------------------------------------------------------------

function generateMarkdownReport(report: BenchmarkReport): string {
  const ws = report.weighted_scores;
  const pv = report.preference_votes;

  let md = `# Tech-Writer Benchmark Results

**Topic**: ${report.topic}
**Date**: ${report.analyzed_at.split("T")[0]}
**Judges**: ${report.successful_judges}/${report.total_judges} successful
**A/B Mapping**: Sample A = ${report.sample_mapping.sample_a}, Sample B = ${report.sample_mapping.sample_b}

## Winner: ${ws.winner.toUpperCase()}

Weighted score: **${ws.techwriter}** (tech-writer) vs **${ws.default}** (default) — delta ${ws.delta >= 0 ? "+" : ""}${ws.delta}

## Per-Criterion Comparison

| Criterion | Weight | Default | Tech-Writer | Winner | Delta |
|-----------|--------|---------|-------------|--------|-------|
`;

  for (const cr of report.criteria_results) {
    const deltaStr = cr.delta >= 0 ? `+${cr.delta}` : `${cr.delta}`;
    md += `| ${cr.criterion_name} | ${cr.weight}x | ${cr.default_mean} | ${cr.techwriter_mean} | ${cr.winner} | ${deltaStr} |\n`;
  }

  const overallDeltaStr = ws.delta >= 0 ? `+${ws.delta}` : `${ws.delta}`;
  md += `| **WEIGHTED OVERALL** | **12.0x** | **${ws.default}** | **${ws.techwriter}** | **${ws.winner}** | **${overallDeltaStr}** |\n`;

  md += `
## Preference Votes

| Metric | Value |
|--------|-------|
| Default votes | ${pv.default}/${pv.total} |
| Tech-Writer votes | ${pv.techwriter}/${pv.total} |
| Consensus | ${pv.consensus_pct}% |
| Winner | ${pv.winner} |

## Judge Details

| Judge | Model | Parse | Preference | Reasoning |
|-------|-------|-------|------------|-----------|
`;

  for (const j of report.judge_details) {
    const prefApproach =
      j.preference === "A" ? report.sample_mapping.sample_a : report.sample_mapping.sample_b;
    const reasoning = j.reasoning.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 100);
    md += `| ${j.judge_id} | ${j.model} | ${j.parse_method} | ${prefApproach} | ${reasoning}... |\n`;
  }

  if (report.failed_judges.length > 0) {
    md += `\n## Failed Judges\n\n`;
    for (const fj of report.failed_judges) {
      md += `- ${fj}\n`;
    }
  }

  md += `
## Score Distribution

`;

  for (const cr of report.criteria_results) {
    md += `### ${cr.criterion_name} (${cr.weight}x)\n`;
    md += `- Default:     ${cr.default_mean} ± ${cr.default_stddev} [${cr.default_min}–${cr.default_max}]\n`;
    md += `- Tech-Writer: ${cr.techwriter_mean} ± ${cr.techwriter_stddev} [${cr.techwriter_min}–${cr.techwriter_max}]\n\n`;
  }

  return md;
}

main();
