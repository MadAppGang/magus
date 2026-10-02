/**
 * setup-state.ts — the vocabulary of "is code-search set up in this project", and the one
 * wording used to ask the user about it.
 *
 * Pure: types, the set of states that prompt, and `setupAdvice()`. No IO and no engine
 * ids. The evaluator that decides which state holds lives outside core/ (it needs the
 * filesystem and the engine catalog); the SessionStart hook, the setup CLI and the MCP
 * server all import it, and all three phrase the prompt through `setupAdvice()` so the
 * user is asked the same question whichever surface asks.
 */

/** The command that runs the guided setup. Also what undoes a dismissal. */
export const SETUP_COMMAND = "/code-search:setup";

/**
 * Every state a project can be in, in EVALUATION ORDER: the first one that holds is the
 * headline, and every problem found is still listed as a finding.
 *
 *   dismissed         `setup: "dismissed"` — the user chose "ignore for this project"
 *   none              `engine: false` — `code_search` with no engine, chosen on purpose
 *   settings_invalid  a settings layer is malformed, wrong-shape or unreadable
 *   unconfigured      no `engine` key in any layer
 *   engine_unknown    the id is not one this build ships, or has no `engines.<id>` entry
 *   engine_missing    the configured `command` is not on PATH
 *   index_missing     the engine's per-project index marker is absent
 *   ready             nothing to do
 *
 * The ripgrep shim (`assets/rg`) is not part of setup: it runs the host's own embedded
 * ripgrep and never reaches an engine, so whether it is installed changes nothing setup
 * is responsible for. `core/health.ts` keeps its assessor (`assessRipgrep`), which has no
 * production caller.
 */
export type SetupStateId =
  | "dismissed"
  | "none"
  | "settings_invalid"
  | "unconfigured"
  | "engine_unknown"
  | "engine_missing"
  | "index_missing"
  | "ready";

export const SETUP_STATE_ORDER: readonly SetupStateId[] = [
  "dismissed",
  "none",
  "settings_invalid",
  "unconfigured",
  "engine_unknown",
  "engine_missing",
  "index_missing",
  "ready",
];

/**
 * The states that prompt the user. `dismissed`, `none` and `ready` never do: the first two
 * are answers the user already gave, and a prompt that ignores an answer is the reason
 * people stop reading prompts.
 */
export const NEEDS_SETUP: ReadonlySet<SetupStateId> = new Set<SetupStateId>([
  "settings_invalid",
  "unconfigured",
  "engine_unknown",
  "engine_missing",
  "index_missing",
]);

/**
 * A finding's code. The prompting states, plus an INFO code that is offered during setup
 * and never prompts on its own:
 *
 *   engine_behind      the installed engine is older than the latest release
 */
export type SetupFindingCode =
  | "settings_invalid"
  | "unconfigured"
  | "engine_unknown"
  | "engine_missing"
  | "index_missing"
  | "engine_behind";

export interface SetupFinding {
  code: SetupFindingCode;
  /** `problem` findings map to a prompting state; `info` findings never prompt. */
  level: "problem" | "info";
  message: string;
  /** A command the user can run, when one exists. Verbatim, copy-pasteable. */
  remedy?: string;
  /** The file or directory the finding is about, when there is one. */
  path?: string;
}

export interface SetupState {
  headline: SetupStateId;
  findings: readonly SetupFinding[];
}

/**
 * When the offer fires: before the FIRST search of this codebase by any means. Grep and Glob
 * are named on purpose — a lookup Grep can answer is still a search of this codebase, and a
 * trigger that lists only the plugin's own tools reads as "Grep does not count" (bench CSO-1
 * scenario 6: asked 2/5 when the prompt did not name code search).
 */
const TRIGGER =
  "Before you first search or investigate this codebase by any means (Grep, Glob, `code_search`, " +
  "the `code-search:analyze` agent, the code-search skills)";

/** The only case that skips the offer: a task that needs no search of this codebase at all. */
const DO_NOT_ASK = "If the task needs no search of this codebase at all, do not ask.";

/** Required in every setup note, full or short, so a subagent can hand it up intact. */
export const RELAY_SENTENCE = "If you cannot ask the user, return this note to your caller verbatim.";

export interface SetupAdviceInput {
  /** The headline state. */
  state: SetupStateId;
  /** One sentence naming what is missing, e.g. "No engine is configured for this project." */
  summary: string;
  /** Absolute path of the setup skill's SKILL.md. */
  skillPath: string;
  /** The exact, copy-pasteable command that dismisses the prompt for this project. */
  dismissCommand: string;
}

export interface SetupAdvice {
  /** The first time in a session: what to say, and the three answers to offer. */
  full: string;
  /** Every later time. Still self-sufficient: state, skill path, dismiss command, relay. */
  short: string;
}

/**
 * The prompt text, or `undefined` for a state that must not prompt.
 *
 * Returning `undefined` rather than an empty string is deliberate: the "silent when
 * dismissed, none or ready" rule lives here once, and a caller cannot print it by accident.
 *
 * THROWS on an empty `summary`, `skillPath` or `dismissCommand`. That is a caller bug, and a
 * note missing its path or its command is precisely the note that cannot be acted on.
 */
export function setupAdvice(input: SetupAdviceInput): SetupAdvice | undefined {
  if (!NEEDS_SETUP.has(input.state)) return undefined;
  for (const key of ["summary", "skillPath", "dismissCommand"] as const) {
    if (input[key].trim() === "") throw new TypeError(`setupAdvice: ${key} is empty`);
  }

  const headline = `Code search setup is incomplete (${input.state}): ${sentence(input.summary)}`;

  const full = [
    headline,
    `${TRIGGER}, say in one or two sentences what is missing, then ask the user ` +
      "with AskUserQuestion, offering exactly these three answers:",
    `- Set up now: read ${input.skillPath} and follow it.`,
    "- Not now: continue without it; the question comes back next session.",
    `- Ignore for this project: run ${input.dismissCommand} — running ${SETUP_COMMAND} later undoes it.`,
    DO_NOT_ASK,
    RELAY_SENTENCE,
  ].join("\n");

  const short = [
    headline,
    `${TRIGGER}, offer to set it up: read ${input.skillPath} and follow it.`,
    `To stop being asked in this project, run ${input.dismissCommand}.`,
    DO_NOT_ASK,
    RELAY_SENTENCE,
  ].join(" ");

  return { full, short };
}

/** Trimmed, and ending in sentence punctuation, so the next sentence does not run on. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}
