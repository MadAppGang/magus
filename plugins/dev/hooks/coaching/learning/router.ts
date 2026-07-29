// Stage 5: Storage Router
// Routes classified learnings to the appropriate storage target
// based on confidence level and learning type.

import type { Learning, ClassifierResult } from "./types";

export interface RoutedLearnings {
  pendingClaudeMd: Learning[]; // HIGH confidence, project-specific → pending-learnings.json
  coachingClaude: Learning[]; // MEDIUM corrections/rules → [claude] section of recommendations
  coachingHuman: Learning[]; // failed_attempts → [human] section of recommendations
  memoryFeedback: Learning[]; // MEDIUM → coaching feedback files
  discarded: Learning[]; // LOW / NOISE
}

const CLAUDE_MD_TYPES = new Set<Learning["type"]>([
  "correction",
  "explicit_rule",
  "repeated_pattern",
  "user_praise",
]);

const COACHING_CLAUDE_TYPES = new Set<Learning["type"]>([
  "correction",
  "explicit_rule",
]);

/**
 * Routes each learning in a ClassifierResult to the appropriate storage target.
 *
 * Routing rules (in priority order):
 *
 * 1. HIGH confidence + project-specific + qualifying type
 *    → pendingClaudeMd (user approval required)
 *
 * 2. MEDIUM confidence + correction or explicit_rule
 *    → coachingHuman + memoryFeedback (visible to the user, never silent)
 *
 * 3. failed_attempt + confidence >= MEDIUM
 *    → coachingHuman
 *
 * 4. LOW confidence or NOISE type
 *    → discarded
 *
 * Nothing the classifier produces reaches `coachingClaude` — the silent
 * behavioural-directive channel — without explicit user approval. Model output
 * is a suggestion until a human accepts it.
 */
export function routeLearnings(result: ClassifierResult): RoutedLearnings {
  const routed: RoutedLearnings = {
    pendingClaudeMd: [],
    coachingClaude: [],
    coachingHuman: [],
    memoryFeedback: [],
    discarded: [],
  };

  for (const learning of result.learnings) {
    const { confidence, type, is_project_specific } = learning;

    // Rule 1: HIGH confidence, project-specific, qualifying type → CLAUDE.md pending
    if (
      confidence === "HIGH" &&
      is_project_specific &&
      CLAUDE_MD_TYPES.has(type)
    ) {
      routed.pendingClaudeMd.push(learning);
      continue;
    }

    // Rule 2: MEDIUM confidence corrections/rules → VISIBLE coaching + memory.
    //
    // These are model-generated guesses about what the user wants. They used to
    // go to `coachingClaude`, which SessionStart injects as a silent behavioural
    // directive — so an unreviewed classifier output became standing policy that
    // the user could not see or audit. Routing them to the human section keeps
    // the learning while putting a person in the loop: the suggestion is shown
    // verbatim in the coaching box and the user decides.
    //
    // Only HIGH-confidence, project-specific learnings earn a persistent home,
    // and those go through `pendingClaudeMd` → `/dev:learn --apply`, which is
    // explicitly approved. The silent [claude] channel is reserved for the
    // deterministic, human-authored rules in rules.json.
    if (confidence === "MEDIUM" && COACHING_CLAUDE_TYPES.has(type)) {
      routed.coachingHuman.push(learning);
      routed.memoryFeedback.push(learning);
      continue;
    }

    // Rule 3: failed_attempt, confidence >= MEDIUM → coaching human section
    if (
      type === "failed_attempt" &&
      (confidence === "HIGH" || confidence === "MEDIUM")
    ) {
      routed.coachingHuman.push(learning);
      continue;
    }

    // Rule 4: LOW confidence or NOISE → discard
    routed.discarded.push(learning);
  }

  return routed;
}
