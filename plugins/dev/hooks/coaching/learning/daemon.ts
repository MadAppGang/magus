#!/usr/bin/env bun
/**
 * Learning Daemon — Background processor (Zone B)
 *
 * Entry point spawned via nohup after the Stop hook.
 * Processes all queue files: summarize transcript → LLM classify → stage learnings.
 * Self-terminates after processing all entries.
 *
 * Usage:
 *   nohup bun daemon.ts <queue-dir> <coaching-dir> >/dev/null 2>&1 &
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
  statSync,
} from "fs";
import { join } from "path";
import type { QueueEntry, DaemonState, ClassifierResult, Learning } from "./types";
import { summarizeTranscript } from "./summarizer";
import { classifySession } from "./classifier";
import { routeLearnings } from "./router";
import {
  loadLearningState,
  saveLearningState,
  isDuplicate,
  reinforceLearning,
  registerLearning,
  checkBudget,
  hashLearning,
} from "./quality-gate";

// =============================================================================
// ATOMIC WRITE
// =============================================================================

export function atomicWrite(path: string, content: string): void {
  const tmp = path + ".tmp." + process.pid;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

// =============================================================================
// LOCK FILE
// =============================================================================

const LOCK_STALE_MS = 10 * 60 * 1000; // 10 minutes

export function acquireLock(lockPath: string): boolean {
  if (existsSync(lockPath)) {
    try {
      const stat = statSync(lockPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < LOCK_STALE_MS) {
        // Lock is fresh — another daemon is running
        return false;
      }
    } catch {
      // Can't stat — assume stale
    }
    // Stale lock — remove and proceed
    try {
      unlinkSync(lockPath);
    } catch {
      // Ignore
    }
  }
  writeFileSync(lockPath, String(process.pid));
  return true;
}

export function releaseLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // Ignore
  }
}

// =============================================================================
// CIRCUIT BREAKER + STATE
// =============================================================================

export function loadDaemonState(statePath: string): DaemonState {
  if (!existsSync(statePath)) {
    return {
      circuit_breaker: { consecutive_failures: 0, disabled_until: null },
      last_run: null,
      total_processed: 0,
      total_queued_for_approval: 0,
    };
  }
  try {
    return JSON.parse(readFileSync(statePath, "utf-8")) as DaemonState;
  } catch {
    return {
      circuit_breaker: { consecutive_failures: 0, disabled_until: null },
      last_run: null,
      total_processed: 0,
      total_queued_for_approval: 0,
    };
  }
}

export function isCircuitBroken(state: DaemonState): boolean {
  if (state.circuit_breaker.disabled_until) {
    const disabledUntil = new Date(
      state.circuit_breaker.disabled_until
    ).getTime();
    if (Date.now() < disabledUntil) return true;
    // Circuit breaker expired — reset
    state.circuit_breaker.consecutive_failures = 0;
    state.circuit_breaker.disabled_until = null;
  }
  return false;
}

export function recordFailure(state: DaemonState): void {
  state.circuit_breaker.consecutive_failures++;
  if (state.circuit_breaker.consecutive_failures >= 3) {
    // Disable for 24 hours
    const disableUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    state.circuit_breaker.disabled_until = disableUntil.toISOString();
  }
}

export function recordSuccess(state: DaemonState): void {
  state.circuit_breaker.consecutive_failures = 0;
  state.circuit_breaker.disabled_until = null;
}

// =============================================================================
// ONLINE CHECK
// =============================================================================

export function isOnline(): boolean {
  try {
    const { execSync } = require("child_process") as typeof import("child_process");
    execSync(
      'curl -s --max-time 5 -o /dev/null -w "" https://api.anthropic.com',
      {
        timeout: 10_000,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// PENDING LEARNINGS
// =============================================================================

export interface PendingLearning {
  session_id: string;
  learning: Learning;
  classified_at: string;
}

export function loadPendingLearnings(path: string): PendingLearning[] {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PendingLearning[];
  } catch {
    return [];
  }
}

// =============================================================================
// RECOMMENDATIONS.MD HELPERS
// =============================================================================

/**
 * Appends a learning to the [claude] or [human] section of recommendations.md.
 * Creates the file with basic structure if it does not exist.
 */
export function appendToRecommendations(
  recommendationsPath: string,
  learning: Learning,
  section: "claude" | "human"
): void {
  let content = "";
  if (existsSync(recommendationsPath)) {
    content = readFileSync(recommendationsPath, "utf-8");
  } else {
    content = "[human]\n\n[claude]\n";
  }

  const bullet = `- ${learning.rule_text}`;
  const note = `  <!-- evidence: ${learning.evidence} -->`;
  const entry = `${bullet}\n${note}`;

  if (section === "claude") {
    // Insert before [claude] tag's trailing content or append after [claude]
    if (content.includes("[claude]")) {
      content = content.replace(
        /(\[claude\])([\s\S]*)$/,
        (_match, tag, rest) => `${tag}\n${entry}${rest ? "\n" + rest.trimStart() : ""}`
      );
    } else {
      content += `\n[claude]\n${entry}\n`;
    }
  } else {
    // Insert before [human] tag's trailing content or append after [human]
    if (content.includes("[human]")) {
      content = content.replace(
        /(\[human\])([\s\S]*?)(\[claude\]|$)/,
        (_match, humanTag, humanBody, nextTag) =>
          `${humanTag}\n${entry}${humanBody ? "\n" + humanBody.trimStart() : "\n"}${nextTag}`
      );
    } else {
      content = `[human]\n${entry}\n\n` + content;
    }
  }

  atomicWrite(recommendationsPath, content);
}

// =============================================================================
// FEEDBACK FILE HELPERS
// =============================================================================

/**
 * Writes a coaching-managed feedback file for a MEDIUM-confidence learning.
 * Files go to {coachingDir}/feedback/feedback_learned_{hash}.md
 */
export function writeFeedbackFile(
  coachingDir: string,
  learning: Learning,
  sessionId: string
): void {
  const feedbackDir = join(coachingDir, "feedback");
  if (!existsSync(feedbackDir)) {
    mkdirSync(feedbackDir, { recursive: true });
  }
  const hash = hashLearning(learning.rule_text);
  const filePath = join(feedbackDir, `feedback_learned_${hash}.md`);
  const content = `---
name: learned-${hash}
description: ${learning.rule_text}
type: feedback
---

${learning.rule_text}

**Why:** Detected from session ${sessionId} — ${learning.evidence}
**How to apply:** ${learning.subsection}
`;
  atomicWrite(filePath, content);
}

export interface DaemonDeps {
  classify?: typeof classifySession;
  checkOnline?: typeof isOnline;
  appendRecommendation?: typeof appendToRecommendations;
  writeFeedback?: typeof writeFeedbackFile;
}

// =============================================================================
// MAIN DAEMON LOGIC
// =============================================================================

export async function runDaemon(
  queueDir: string,
  coachingDir: string,
  deps: DaemonDeps = {}
): Promise<void> {
  const classify = deps.classify ?? classifySession;
  const checkOnline = deps.checkOnline ?? isOnline;
  const appendRecommendation = deps.appendRecommendation ?? appendToRecommendations;
  const writeFeedback = deps.writeFeedback ?? writeFeedbackFile;

  const lockPath = join(queueDir, "queue.lock");
  // learning-state.json holds daemon operational state (circuit breaker, counters)
  const statePath = join(coachingDir, "learning-state.json");
  // dedup-state.json holds the quality gate's dedup/staleness map
  const dedupStatePath = join(coachingDir, "dedup-state.json");
  const pendingPath = join(coachingDir, "pending-learnings.json");
  const recommendationsPath = join(coachingDir, "recommendations.md");

  // Acquire lock
  if (!acquireLock(lockPath)) {
    return; // Another daemon is running
  }

  try {
    // Load daemon state and check circuit breaker
    const state = loadDaemonState(statePath);

    if (isCircuitBroken(state)) {
      return; // Circuit breaker active
    }

    // Check online status
    if (!checkOnline()) {
      return; // Offline — queue files persist for next run
    }

    // Read queue files
    if (!existsSync(queueDir)) return;
    const queueFiles = readdirSync(queueDir)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".failed"))
      .filter((f) => f !== "queue.lock");

    if (queueFiles.length === 0) return;

    // Load dedup/staleness state and pending learnings
    const learningState = loadLearningState(dedupStatePath);
    let pendingLearnings = loadPendingLearnings(pendingPath);

    for (const file of queueFiles) {
      const filePath = join(queueDir, file);

      try {
        const entry: QueueEntry = JSON.parse(
          readFileSync(filePath, "utf-8")
        );

        // Check transcript still exists
        if (!existsSync(entry.transcript_path)) {
          unlinkSync(filePath); // Remove orphaned queue entry
          continue;
        }

        // Stage 3: Summarize transcript (no LLM)
        const summary = summarizeTranscript(entry);

        // Stage 4: LLM classification
        const result: ClassifierResult = await classify(summary, {
          tmpDir: coachingDir,
        });

        recordSuccess(state);
        state.total_processed++;

        // Stage 5: Route learnings
        const routed = routeLearnings(result);

        // Stage 6: Quality gate + write to storage

        // Build a set of hashes already in pending queue for fast dedup lookup
        const pendingHashes = new Set(
          pendingLearnings.map((pl) => hashLearning(pl.learning.rule_text))
        );

        // --- pendingClaudeMd: dedup + budget check → pending-learnings.json ---
        for (const learning of routed.pendingClaudeMd) {
          const hash = hashLearning(learning.rule_text);

          // Skip if already applied to CLAUDE.md (staged_to_claude_md === true)
          if (isDuplicate(learning, learningState)) {
            reinforceLearning(learning, learningState, entry.session_id);
            continue;
          }

          // Skip if the exact same learning is already pending approval
          if (pendingHashes.has(hash)) {
            reinforceLearning(learning, learningState, entry.session_id);
            continue;
          }

          const claudeMdPath = join(entry.cwd, "CLAUDE.md");
          const budget = checkBudget(learning.line_cost, claudeMdPath);
          if (!budget.ok) {
            // Budget exhausted — discard silently
            continue;
          }
          pendingLearnings.push({
            session_id: entry.session_id,
            learning,
            classified_at: new Date().toISOString(),
          });
          pendingHashes.add(hash);
          registerLearning(learning, learningState, entry.session_id);
          state.total_queued_for_approval++;
        }

        // --- coachingClaude: append to [claude] section ---
        for (const learning of routed.coachingClaude) {
          try {
            appendRecommendation(recommendationsPath, learning, "claude");            registerLearning(learning, learningState, entry.session_id);
          } catch {
            // Silent — coaching augmentation failures do not abort processing
          }
        }

        // --- coachingHuman: append to [human] section ---
        for (const learning of routed.coachingHuman) {
          try {
            appendRecommendation(recommendationsPath, learning, "human");            registerLearning(learning, learningState, entry.session_id);
          } catch {
            // Silent
          }
        }

        // --- memoryFeedback: write per-learning feedback files ---
        for (const learning of routed.memoryFeedback) {
          try {
            writeFeedback(coachingDir, learning, entry.session_id);
          } catch {
            // Silent
          }
        }

        // Remove processed queue file
        unlinkSync(filePath);
      } catch (err) {
        // Mark as failed
        recordFailure(state);
        const failedPath = filePath.replace(".json", ".failed");
        const errorMsg = err instanceof Error ? err.message : String(err);
        writeFileSync(
          failedPath,
          JSON.stringify({
            error: errorMsg,
            failed_at: new Date().toISOString(),
          })
        );
        try {
          unlinkSync(filePath);
        } catch {
          // Ignore if already removed
        }

        // If circuit breaker just tripped, stop processing
        if (isCircuitBroken(state)) break;
      }
    }

    // Write updated daemon state
    state.last_run = new Date().toISOString();
    atomicWrite(statePath, JSON.stringify(state, null, 2));

    // Write updated dedup/staleness state
    learningState._session_count++;
    saveLearningState(dedupStatePath, learningState);

    // Write pending learnings if any exist
    if (pendingLearnings.length > 0) {
      atomicWrite(pendingPath, JSON.stringify(pendingLearnings, null, 2));
    }
  } finally {
    releaseLock(lockPath);
  }
}

// =============================================================================
// ENTRY POINT
// =============================================================================

async function main(): Promise<void> {
  // Args: daemon.ts <queue-dir> <coaching-dir>
  const queueDir = process.argv[2];
  const coachingDir = process.argv[3];

  if (!queueDir || !coachingDir) {
    process.exit(1);
  }

  await runDaemon(queueDir, coachingDir);
}

// Only run main when invoked directly (not imported as a module)
if (import.meta.main) {
  main().catch(() => {
    // Daemon failures are completely silent (background process)
    process.exit(1);
  });
}
