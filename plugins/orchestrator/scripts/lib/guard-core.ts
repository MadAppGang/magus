// Pure core of the gatekeeper guard: which ticket a session owns, whether a
// call targets it, and the decision for one PreToolUse call. No IO; never throws.
//
// What it stops, and what it does not: the guard keeps a cooperative model
// that drifts out of its role from reaching the tracker with the ordinary
// forms such a model writes: `gh` in a plain command, a compound line, a
// substitution, a heredoc, a wrapper, a runtime flag, a tracker MCP tool. It
// is not a sandbox against a model deliberately evading it. Command words
// built at runtime (`g=gh; $g …`, `gh iss${U}ue`, `$'\x67h'`, a glob), other
// HTTP clients (curl, wget) and interpreters (`python -c`, `node -e` run on
// its own) that reach the tracker API are out of scope, and are not chased by
// pattern-matching.
//
// Triage is the only gatekeeper. A manager may set its own ticket's state and
// assignee, comment on it and attach links or files; nothing else on the
// tracker, and it starts no ticket sessions (children only, with
// `--print-line`, or a `--dry-run`). A child writes nothing to the tracker and
// starts no sessions. Sessions with no role (unbound, triage) pass.
//
// Bash is judged by an allow-list, not by recognising every dangerous form. A
// command that could reach the tracker (it names `gh` with `issue`, `label`,
// `api`, `project` or `alias`, or names the launcher) may hold no command or
// process substitution anywhere, an unquoted heredoc body included, and no
// command that runs text it is given (a shell, `eval`, `xargs`, a runtime
// with no script). Each of its segments that names `gh` or the launcher must
// then be one plain command in one of a few explicit forms; the other
// segments (`cd`, `| head`) pass. Heredoc bodies under a quoted delimiter that
// only feed data are not read as commands; when such a body is the only place
// a line names `gh` or the launcher, the line is refused if any segment runs a
// file or text, since that may be the file the body was written to. Any other
// command passes untouched.
//
// Tracker MCP servers: every write of a server named for Linear, Jira,
// YouTrack, Shortcut, ClickUp or Asana, and the issue, label, project and
// milestone writes of a GitHub, GitLab or Atlassian server. A tracker behind
// any other server name is not seen.

import {
  type GhSegment,
  type ShellToken,
  basename,
  commandWordIndex,
  commandWords,
  ghSegment,
  hasGroup,
  hasSubstitution,
  isAssignment,
  isRuntimeCodeFlag,
  redirectTargets,
  scanHeredocs,
  shellSegments,
} from "./gh-argv.ts";
import type { OrchestratorRole, OrchestratorTicket } from "./state-core.ts";
import { parseTicketRef } from "./ticket.ts";
import { parseArgs } from "./window.ts";

/** The ticket a session owns, in the form calls are compared against. */
export type OwnTicket =
  /** `repo` is lower-cased `owner/name`, or null when the ticket names none. */
  | { tracker: "github"; repo: string | null; number: number; label: string }
  /** `key` is upper-cased, e.g. `ABC-7`. */
  | { tracker: "key"; key: string; label: string };

export type GuardInput = {
  /** The owned record's role; null when the session owns no record. */
  role: OrchestratorRole | null;
  own: OwnTicket | null;
  toolName: string;
  toolInput: unknown;
};

export type GuardDecision = { kind: "allow" } | { kind: "deny"; reason: string };

/** A target a tracker call names. */
export type GuardTarget =
  | { tracker: "github"; repo: string | null; number: number }
  | { tracker: "key"; key: string }
  | { tracker: "uuid" }
  | { tracker: "unknown" };

const ALLOW: GuardDecision = { kind: "allow" };

const GITHUB_ISSUE_URL_RE = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/([0-9]+)\/?(?:[?#].*)?$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ticket a record names, ready for comparison. A GitHub id gives the
 * number and, from `owner/repo#N`, the repo; a `#N` takes its repo from a
 * GitHub issue URL with the same number, else none. Any other parseable id is
 * a key. Null for no ticket or an id that does not parse.
 */
export function ownTicketOf(ticket: OrchestratorTicket | null): OwnTicket | null {
  if (ticket === null) return null;
  const ref = parseTicketRef(ticket.id, null);
  if (ref === null) return null;
  if (ref.tracker === "github" && ref.number !== null) {
    let repo = ref.repo;
    if (repo === null && ticket.url !== null) {
      const m = GITHUB_ISSUE_URL_RE.exec(ticket.url.trim());
      if (m !== null && Number(m[3]) === ref.number) repo = `${m[1]}/${m[2]}`;
    }
    return { tracker: "github", repo: repo === null ? null : repo.toLowerCase(), number: ref.number, label: repo === null ? `#${ref.number}` : `${repo}#${ref.number}` };
  }
  const key = ref.id.toUpperCase();
  return { tracker: "key", key, label: key };
}

/** True when `target` is the own ticket: same key (case-insensitive), or same GitHub repo and number. */
export function isOwn(own: OwnTicket | null, target: GuardTarget): boolean {
  if (own === null) return false;
  if (own.tracker === "key") return target.tracker === "key" && target.key.toUpperCase() === own.key;
  return target.tracker === "github" && own.repo !== null && target.repo !== null && target.repo.toLowerCase() === own.repo && target.number === own.number;
}

// --- reasons ------------------------------------------------------------------------------

const R_LAUNCH =
  "Tickets and ticket sessions belong to triage. Send triage the request by SendMessage, with what you read or ran. " +
  "A child for a part in another repo starts with ticket-window.ts --print-line; --dry-run checks a start and opens nothing.";
const R_CHILD_LAUNCH = "A child starts no sessions. Send the need to your manager by SendMessage.";
const R_CHILD_TRACKER = "A child never writes to the tracker. Send the finding or ticket need to your manager by SendMessage.";

function rScope(own: OwnTicket | null, ending?: string): string {
  const may =
    own === null
      ? "This session has no ticket recorded: run /orchestrator:manager with the ticket id and URL."
      : `This session may set ${own.label}'s state and assignee, comment on it, and attach links or files: progress goes in a comment.`;
  const text =
    "Only triage creates tickets or changes them (title, description, labels, splitting, merging, links, another ticket). " +
    `${may} Send the change to triage by SendMessage, with what you read or ran.`;
  return ending === undefined ? text : `${text} ${ending}`;
}

function rUuid(own: OwnTicket | null): string {
  const address = own === null ? "its key" : own.label;
  return `This guard matches your ticket by its key, not an id. Address your own ticket as ${address}; for any other ticket, send the change to triage by SendMessage.`;
}

function refused(name: string): string {
  return `Refused: ${name}.`;
}

function passRepo(own: OwnTicket | null): string {
  // The label is `<repo as stored>#N` whenever the ticket names its repo.
  const repo = own !== null && own.tracker === "github" && own.repo !== null ? own.label.slice(0, own.label.lastIndexOf("#")) : "<owner/repo>";
  return `Pass -R ${repo} and set no GH_REPO: a gh write counts as your ticket's only when it names the repo.`;
}

const PR_COMMENT = "For a pull request, use gh pr comment.";

const PLAIN_ONLY =
  "A command that names gh with issue, label, api, project or alias, or names the launcher, runs only as a plain command: " +
  "no $(…), backtick, <(…), >(…) or unquoted heredoc holding them anywhere in the line, no loop, if, { }, ( ), $VAR, eval, sh, xargs, env, time or timeout around it, " +
  "and nothing piped into a shell; cd before it and | head after it are fine.";
const SUBSTITUTION =
  "Refused: $(…), a backtick, <(…) or >(…) in a command that names gh or the launcher; the shell runs it, so it is code, not text. " +
  "For a comment, write the text to a file and pass --body-file <file>, or feed it with --body-file - <<'EOF' (a quoted delimiter keeps the body as text). " +
  "Otherwise run the part that names gh or the launcher as its own call, apart from the substitution.";
const READ_FORMS = "gh issue view|list|status; gh label list|view; gh pr …; gh api <endpoint> as a GET (no -X other than GET, no -f, -F or --input)";
const MENTION_TEXT = "Text that only mentions gh or the launcher, such as a commit message, goes in a heredoc or a file.";

/**
 * The denial for a command that could reach the tracker and is not an allowed
 * form: `why`, who owns the change, and the forms this role may run, with the
 * own ticket's number and repo filled in when the record names them.
 */
function rForms(role: "manager" | "child", own: OwnTicket | null, why: string): string {
  if (role === "child") return `${why} ${R_CHILD_TRACKER} ${PLAIN_ONLY} Allowed: ${READ_FORMS}. ${MENTION_TEXT}`;
  const github = own !== null && own.tracker === "github" && own.repo !== null;
  const n = github ? String(own.number) : "<N>";
  const repo = github ? own.label.slice(0, own.label.lastIndexOf("#")) : "<owner/repo>";
  return (
    `${why} Tickets and ticket sessions belong to triage: send triage the request by SendMessage, with what you read or ran. ${PLAIN_ONLY} ` +
    `Allowed: ${READ_FORMS}; gh issue comment ${n} -R ${repo} --body|--body-file|--attach …; ` +
    `gh issue edit ${n} -R ${repo} --add-assignee|--remove-assignee …; gh issue close|reopen ${n} -R ${repo} [--comment …]; ` +
    `ticket-window.ts --print-line to start a child, or --dry-run. ${MENTION_TEXT}`
  );
}

function deny(reason: string): GuardDecision {
  return { kind: "deny", reason };
}

// --- Skill and SlashCommand ---------------------------------------------------------------

/** The start-ticket command, by its qualified name or the bare name Claude Code also accepts. */
const START_TICKET = new Set(["orchestrator:start-ticket", "start-ticket"]);

/** The skill or command a Skill/SlashCommand call names, without a leading `/` or arguments. */
function invokedName(toolInput: unknown): string | null {
  if (toolInput === null || typeof toolInput !== "object") return null;
  const input = toolInput as Record<string, unknown>;
  const raw = typeof input.skill === "string" ? input.skill : typeof input.command === "string" ? input.command : null;
  if (raw === null) return null;
  return raw.trim().replace(/^\/+/, "").split(/\s+/)[0] ?? null;
}

// --- Bash ---------------------------------------------------------------------------------

const LAUNCHER = "ticket-window.ts";

/** Words that, beside a `gh` word, mean the command could reach the tracker. */
const TRACKER_WORDS = new Set(["issue", "label", "api", "project", "alias"]);

const ISSUE_READS = new Set(["view", "list", "status"]);
const LABEL_READS = new Set(["list", "view"]);
const PROJECT_READS = new Set(["list", "view", "field-list", "item-list"]);

/** A manager's `gh issue` writes on its own ticket, each with the only flags it may carry. */
const MANAGER_ISSUE_WRITES: Readonly<Record<string, ReadonlySet<string>>> = {
  comment: new Set(["--repo", "--body", "--body-file", "--attach"]),
  edit: new Set(["--repo", "--add-assignee", "--remove-assignee"]),
  close: new Set(["--repo", "--comment", "--reason"]),
  reopen: new Set(["--repo", "--comment"]),
};
/** `gh issue close --reason` values that only set state; `duplicate` merges tickets. */
const CLOSE_REASONS = new Set(["completed", "not planned"]);

/** The `gh api` flags a GET may carry; `--method` only as GET. */
const API_GET_FLAGS = new Set(["--method", "--header", "--jq", "--template", "--include", "--paginate", "--slurp", "--hostname", "--silent", "--verbose", "--cache", "--preview"]);

/** Commands that only read or record a word they are given: naming gh or the launcher in them runs neither. */
const MENTION_COMMANDS = new Set(["cat", "head", "tail", "wc", "ls", "stat", "file", "grep", "egrep", "fgrep", "rg", "echo", "printf", "less"]);
/**
 * `git` subcommands that only record or show text, written right after `git`
 * (so no global `-c`, `-C`, `--exec-path`, `-p`/`--paginate` before them).
 */
const GIT_MENTION_SUBCOMMANDS = new Set(["add", "commit", "status", "diff", "log", "show"]);
/**
 * Flags of a mention command that run another program or reach a configured
 * one: a pager, a preprocessor, a diff driver; under `git`, also `-c`, `-C`
 * and `--config`/`--config-env` in every spelling (a configuration value, one
 * read from the environment, or another repository's configuration).
 */
function runsProgramFlag(word: string, git: boolean): boolean {
  if (/^-O/.test(word) || /^--(open-files-in-pager|pre|ext-diff|textconv|exec|paginate)(=|-|$)/.test(word)) return true;
  // `-c`, `-C` alone or with the value attached (`-ccore.pager=x`), and `--config…` in any spelling (`--config-env=…`).
  return git && (/^-[cC]/.test(word) || /^--config/.test(word));
}
/** A `sed -n` script that only prints lines: `12p`, `1,40p`, `5,$p`. */
const SED_PRINT_RE = /^[0-9]+(,([0-9]+|\$))?p$/;
/** This plugin's own scripts that never reach the tracker or start a session. */
const OWN_SCRIPTS = new Set(["orch-state.ts", "ticket-ref.ts"]);
/** Runtime flags allowed before this plugin's scripts: the ones its skills pass. */
const RUNTIME_PLAIN_FLAG_RE = /^--(env-file|config)=|^--no-env-file$|^run$/;

/** Commands that run text they are given as commands, from an argument or their input. */
const FEEDERS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "eval", "xargs", "source", ".", "parallel", "env", "python", "python3", "perl", "ruby", "deno"]);
/** Shell words that open or continue a loop, a condition or a group. */
const SHELL_KEYWORDS = new Set(["for", "while", "until", "do", "done", "if", "then", "else", "elif", "fi", "case", "esac", "{", "}", "!", "time", "function", "select", "coproc"]);
/** Assignments in front of a command that make it run another program: a pager, an editor, a browser, a preload. */
const PROGRAM_VAR_RE = /PAGER|EDITOR|VISUAL|BROWSER|^BASH_ENV$|^ENV$|^PROMPT_COMMAND$|^LD_|^DYLD_|^NODE_OPTIONS$|^BUN_OPTIONS$/;

type GhOwnership = { own: true } | { own: false; ending: string };

/**
 * Whether a `gh` write segment targets the own ticket. It must name the repo
 * with `-R`/`--repo` equal to the ticket's, it must have at least one ref, and
 * every ref must be the own number in the own repo. A `gh` write with no `-R`
 * is never own: gh resolves the repo from the checkout or `GH_REPO`, which the
 * guard cannot see.
 */
function ghOwnership(own: OwnTicket | null, seg: GhSegment): GhOwnership {
  if (own === null) return { own: false, ending: "" };
  if (own.tracker !== "github") return { own: false, ending: refused(`a GitHub issue, while this session's ticket is ${own.label}`) };
  const repos = (seg.flags.get("--repo") ?? []).map((r) => r.toLowerCase());
  if (repos.length === 0 || own.repo === null || repos.some((r) => r !== own.repo)) {
    return { own: false, ending: passRepo(own) };
  }
  if (seg.refs.length === 0) return { own: false, ending: refused("a gh issue write that names no issue") };
  for (const text of seg.refs) {
    const ref = parseTicketRef(text, own.repo);
    const repo = ref?.repo?.toLowerCase() ?? null;
    if (ref === null || ref.tracker !== "github" || ref.number !== own.number || repo !== own.repo) {
      return { own: false, ending: refused(text) };
    }
  }
  return { own: true };
}

function scopeDenial(own: OwnTicket | null, ending: string): GuardDecision {
  return deny(rScope(own, ending === "" ? undefined : ending));
}

/**
 * True when a command (heredoc data already removed) could reach the tracker
 * or start a session: a word names the launcher (`ticket-window`), or a word
 * from `TRACKER_WORDS` stands beside a `gh` word or beside a command word that
 * is a variable, which may hold `gh`.
 */
function reachesTracker(text: string): boolean {
  return wordsReach(commandWords(text), shellSegments(text));
}

/** One segment of a command that reaches the tracker: does this segment itself? */
function segmentReaches(tokens: readonly ShellToken[]): boolean {
  const words = new Set<string>();
  for (const t of tokens) for (const w of commandWords(t.text)) words.add(w);
  return wordsReach(words, [{ tokens: [...tokens] }]);
}

function wordsReach(words: ReadonlySet<string>, segments: readonly { tokens: readonly ShellToken[] }[]): boolean {
  let gh = false;
  let tracker = false;
  for (const w of words) {
    if (w.includes("ticket-window")) return true;
    if (basename(w) === "gh") gh = true;
    if (TRACKER_WORDS.has(w)) tracker = true;
  }
  if (!tracker) return false;
  if (gh) return true;
  return segments.some((s) => {
    const at = commandWordIndex(s.tokens);
    return at !== -1 && s.tokens[at]?.expanded === true;
  });
}

/** True when a script path holds no `$(…)` or backtick; a `$VAR` before its last `/` is allowed. */
function plainPath(token: ShellToken): boolean {
  return !token.expanded || !/\$\(|`/.test(token.text);
}

/** True when a runtime word list before a script holds only the flags this plugin's skills pass. */
function plainRuntimeHead(head: readonly ShellToken[]): boolean {
  for (let i = 1; i < head.length; i++) {
    const t = head[i]?.text ?? "";
    if (t === "--env-file" || t === "--config") {
      // The value is the next word; a flag with no word after it before the script takes the script.
      if (i + 1 >= head.length) return false;
      i++;
      continue;
    }
    if (!RUNTIME_PLAIN_FLAG_RE.test(t)) return false;
  }
  return true;
}

/**
 * True when one plain command only reads or records the words it names: a
 * reader or `echo` with no flag that runs a program (`rg --pre`, `grep -O`),
 * `sed -n` printing a line range, `bun test` with no flag that loads code,
 * `git add|commit|status|diff|log|show` written right after `git` with no
 * pager, diff-driver or configuration flag, or this plugin's own
 * `orch-state.ts` / `ticket-ref.ts` run with only the runtime flags its
 * skills pass. No assignment may precede it and no word may hold an
 * expansion, except a `$VAR` in the plugin script's path.
 */
function isMention(tokens: readonly ShellToken[], at: number, wrapped: boolean): boolean {
  if (isAssignment(tokens[0]?.text ?? "")) return false;
  const word = basename(tokens[at]?.text ?? "");
  if (wrapped) {
    return OWN_SCRIPTS.has(word) && plainRuntimeHead(tokens.slice(0, at)) && plainPath(tokens[at] as ShellToken) && tokens.every((t, i) => i === at || !t.expanded);
  }
  if (at !== 0 || tokens.some((t) => t.expanded)) return false;
  const args = tokens.slice(1).map((t) => t.text);
  if (word === "git") return GIT_MENTION_SUBCOMMANDS.has(args[0] ?? "") && !args.some((a) => runsProgramFlag(a, true));
  if (word === "sed") return args[0] === "-n" && SED_PRINT_RE.test(args[1] ?? "") && !args.slice(2).some((a) => a.startsWith("-"));
  if (word === "bun") return args[0] === "test" && !args.some((a) => a.startsWith("-") && isRuntimeCodeFlag(a));
  return MENTION_COMMANDS.has(word) && !args.some((a) => runsProgramFlag(a, false));
}

/** `gh api` as a read: GET only, no field, input or method-override header, one endpoint. */
function decideApi(role: "manager" | "child", own: OwnTicket | null, seg: GhSegment): GuardDecision {
  for (const [flag, values] of seg.flags) {
    if (!API_GET_FLAGS.has(flag)) return deny(rForms(role, own, refused(`gh api ${flag}`)));
    const bad = values.find((v) => (flag === "--method" && v.trim().toUpperCase() !== "GET") || (flag === "--header" && /method-override/i.test(v)));
    if (bad !== undefined) return deny(rForms(role, own, refused(`gh api ${flag} ${bad}`)));
  }
  if (seg.verb === null || seg.refs.length > 0) return deny(rForms(role, own, refused("gh api with no endpoint or more than one")));
  return ALLOW;
}

/**
 * One plain `gh` command. Reads pass for both roles: `gh issue view|list|status`,
 * `gh label list|view`, `gh project` reads, every `gh pr` command, and `gh api`
 * as a GET. A manager may also run, on its own ticket and with no assignment in
 * front, `gh issue comment|edit|close|reopen`, each with only the flags
 * `MANAGER_ISSUE_WRITES` lists. Everything else is denied.
 */
function decideGh(role: "manager" | "child", own: OwnTicket | null, seg: GhSegment, assigned: boolean, setsGhRepo: boolean): GuardDecision {
  const { group, verb } = seg;
  if (group === "pr") return ALLOW;
  if (group === "issue" && (verb === null || ISSUE_READS.has(verb))) return ALLOW;
  if (group === "label" && (verb === null || LABEL_READS.has(verb))) return ALLOW;
  if (group === "project" && (verb === null || PROJECT_READS.has(verb))) return ALLOW;
  if (group === "api") return decideApi(role, own, seg);
  const name = `gh ${[group, verb].filter((p) => p !== null).join(" ")}`;
  const allowedFlags = group === "issue" && verb !== null ? MANAGER_ISSUE_WRITES[verb] : undefined;
  if (role === "child" || allowedFlags === undefined) return deny(rForms(role, own, refused(name)));
  if (assigned) return scopeDenial(own, `${refused(`a variable assignment before ${name}`)} ${passRepo(own)}`);
  if (setsGhRepo) return scopeDenial(own, `${refused(`GH_REPO set in the same call as ${name}`)} ${passRepo(own)}`);
  const ownership = ghOwnership(own, seg);
  if (!ownership.own) return scopeDenial(own, ownership.ending);
  for (const flag of seg.flags.keys()) if (!allowedFlags.has(flag)) return scopeDenial(own, refused(flag));
  const reason = (seg.flags.get("--reason") ?? []).find((r) => !CLOSE_REASONS.has(r.trim().toLowerCase()));
  if (reason !== undefined) return scopeDenial(own, refused(`--reason ${reason}`));
  return ALLOW;
}

/**
 * One plain command that could reach the tracker: `gh` with no wrapper and no
 * expansion; the launcher, run directly or by `bun`/`node`, with no
 * assignment in front and no expansion but a `$VAR` in its path, whose own
 * `parseArgs` reads `--print-line` or a `--dry-run` start (manager only); or a
 * command that only mentions them (`isMention`). Anything else is denied.
 */
function decidePlain(role: "manager" | "child", own: OwnTicket | null, tokens: readonly ShellToken[], setsGhRepo: boolean): GuardDecision {
  let k = 0;
  while (k < tokens.length && isAssignment(tokens[k]?.text ?? "")) k++;
  const program = tokens.slice(0, k).find((t) => {
    const name = t.text.slice(0, t.text.indexOf("="));
    const value = t.text.slice(t.text.indexOf("=") + 1);
    return PROGRAM_VAR_RE.test(name) && value !== "" && value !== "cat";
  });
  if (program !== undefined) return deny(rForms(role, own, refused(`${program.text.slice(0, program.text.indexOf("="))}=…, which runs another program`)));
  const at = commandWordIndex(tokens);
  if (at === -1) {
    // Only literal assignments, or a literal `command -v` probe: nothing runs.
    const probe = basename(tokens[k]?.text ?? "") === "command";
    if ((k === tokens.length || probe) && tokens.every((t) => !t.expanded)) return ALLOW;
    return deny(rForms(role, own, refused(`${tokens[k]?.text ?? "an assignment"} with no command word this guard can read`)));
  }
  const head = tokens.slice(k, at);
  const runtime = basename(head[0]?.text ?? "");
  const wrapped = head.length > 0;
  const word = basename(tokens[at]?.text ?? "");
  if (SHELL_KEYWORDS.has(word)) {
    return deny(rForms(role, own, refused("a loop, a condition or a group around a command that names gh or the launcher")));
  }
  if (wrapped && runtime !== "bun" && runtime !== "node") {
    return deny(rForms(role, own, refused(`${basename(head[0]?.text ?? "")} around another command`)));
  }
  if (word === LAUNCHER) {
    if (role === "child") return deny(R_CHILD_LAUNCH);
    if (k > 0) return deny(`${refused("a variable assignment before the launcher")} ${R_LAUNCH}`);
    if (!plainRuntimeHead(head)) return deny(`${refused(`runtime flags other than --env-file, --config, --no-env-file or run before the launcher`)} ${R_LAUNCH}`);
    const others = tokens.filter((_, i) => i !== at);
    if (!plainPath(tokens[at] as ShellToken) || others.some((t) => t.expanded)) {
      return deny(`${refused("$(…), a backtick or a variable in a launcher call")} ${R_LAUNCH}`);
    }
    const parsed = parseArgs(
      tokens.slice(at + 1).map((t) => t.text),
      {},
    );
    if (parsed.ok && (parsed.args.mode === "print-line" || (parsed.args.mode === "start" && parsed.args.dryRun))) return ALLOW;
    return deny(R_LAUNCH);
  }
  if (word === "gh" && !wrapped) {
    if (tokens.some((t) => t.expanded)) return deny(rForms(role, own, refused("$(…), a backtick or a variable in a gh command")));
    return decideGh(role, own, ghSegment(tokens.slice(at + 1)), k > 0, setsGhRepo);
  }
  if (isMention(tokens, at, wrapped)) return ALLOW;
  return deny(rForms(role, own, refused(`${word}, which names gh or the launcher and is not an allowed form`)));
}

/** True when a segment's command word runs text it is given: a shell, `eval`, `xargs`, `env -S`, a runtime with no script. */
function feedsCommands(tokens: readonly ShellToken[], at: number): boolean {
  const word = basename(tokens[at]?.text ?? "");
  if (FEEDERS.has(word)) return true;
  // `bun`/`node` as the command word: inline code, a preload, or a program read from input. `bun test` runs test files.
  return (word === "bun" || word === "node") && !(word === "bun" && tokens[at + 1]?.text === "test");
}

/** Commands that run the command they are given as arguments. */
const WRAPPERS = new Set(["nohup", "timeout", "nice", "time", "stdbuf", "setsid", "sudo", "doas", "watch", "caffeinate", "script", "strace", "dtruss", "ionice", "taskset", "chrt", "unbuffer"]);

/**
 * For a line whose only mention of `gh` or the launcher sits in a heredoc
 * body that feeds data (`cat > f <<'EOF' … EOF`): the command word of the
 * first segment that runs a file or text, which may be the file that body was
 * just written to; null when no segment does. Such a segment's command word is
 * a shell or another command in `FEEDERS`, `bun` or `node` themselves, a
 * script run by them, a shell keyword, a wrapper, a variable, a path
 * (`./x.sh`, `/tmp/x.sh`), or a bare name the line writes as a file
 * (`cat > job … job`) or names elsewhere as a path's last component
 * (`~/bin/x … x`). This plugin's `orch-state.ts` and
 * `ticket-ref.ts`, run in the form the skills use and named nowhere else on
 * the line, do not count: a heredoc fed to them is their input.
 */
function runsWrittenFile(text: string): string | null {
  const written = new Set<string>();
  for (const w of commandWords(text)) if (w.includes("/")) written.add(basename(w));
  for (const target of redirectTargets(text)) written.add(basename(target));
  for (const { tokens } of shellSegments(text)) {
    const at = commandWordIndex(tokens);
    if (at === -1) continue;
    const token = tokens[at] as ShellToken;
    const word = basename(token.text);
    const wrapped = at > 0 && !isAssignment(tokens[at - 1]?.text ?? "");
    if (wrapped && OWN_SCRIPTS.has(word) && isMention(tokens, at, true) && text.split(word).length === 2) continue;
    if (wrapped || feedsCommands(tokens, at) || word === "bun" || word === "node") return word;
    if (SHELL_KEYWORDS.has(word) || WRAPPERS.has(word) || token.expanded || token.text.includes("/") || written.has(word)) return word;
  }
  return null;
}

/**
 * A Bash call for a manager or a child. Heredoc bodies that only feed data are
 * removed first. A command that cannot reach the tracker (`reachesTracker`)
 * even with them passes untouched; one that reaches it only through them is
 * denied when a segment runs a file or text (`runsWrittenFile`), and passes
 * otherwise. One that reaches it without them is denied when it holds a command or process
 * substitution anywhere (an unquoted heredoc body included), when it holds a
 * `( )` group, a function or a `case` pattern (`hasGroup`), when any segment
 * runs text it is given (`feedsCommands`), or, with more than one segment,
 * when a segment's command word is a variable. Otherwise every segment that
 * itself names `gh` or the launcher must be a plain command in an allowed
 * form (`decidePlain`); the others (`cd <dir>`, `| head`) pass. A `GH_REPO`
 * word anywhere in the call (`export GH_REPO=…; …`, `…; GH_REPO=…`) makes
 * every manager `gh issue` write in it not the own ticket's.
 */
function decideBash(role: "manager" | "child", own: OwnTicket | null, toolInput: unknown): GuardDecision {
  if (toolInput === null || typeof toolInput !== "object") return ALLOW;
  const command = (toolInput as Record<string, unknown>).command;
  if (typeof command !== "string") return ALLOW;
  const scan = scanHeredocs(command);
  const text = scan.text;
  if (!reachesTracker(text)) {
    if (!reachesTracker(command)) return ALLOW;
    const runner = runsWrittenFile(text);
    return runner === null ? ALLOW : deny(rForms(role, own, refused(`${runner}, which runs a file or text, on a line whose heredoc names gh or the launcher`)));
  }
  if (scan.substitutingBody || hasSubstitution(text)) return deny(rForms(role, own, SUBSTITUTION));
  if (hasGroup(text)) return deny(rForms(role, own, refused("a ( ) group, a function or a case pattern in a command that names gh or the launcher")));
  const segments = shellSegments(text);
  const setsGhRepo = segments.some(({ tokens }) => tokens.some((t) => /^GH_REPO(=|$)/.test(t.text)));
  for (const { tokens } of segments) {
    const at = commandWordIndex(tokens);
    if (at === -1) continue;
    if (feedsCommands(tokens, at)) {
      return deny(rForms(role, own, refused(`${basename(tokens[at]?.text ?? "")}, which runs text it is given as commands, in a command that names gh or the launcher`)));
    }
    if (segments.length > 1 && tokens[at]?.expanded === true) return deny(rForms(role, own, refused("a variable as a command word")));
  }
  for (const { tokens } of segments) {
    if (segments.length > 1 && !segmentReaches(tokens)) continue;
    const decision = decidePlain(role, own, tokens, setsGhRepo);
    if (decision.kind === "deny") return decision;
  }
  return ALLOW;
}

// --- tracker MCP tools ------------------------------------------------------------------

const COMMENT_TARGET_KEYS = ["issueId", "issue_id", "issue", "number", "issue_number", "issueNumber", "issueIdOrKey", "issueKey"];
const ATTACHMENT_TARGET_KEYS = ["issue", "issueId", "issue_id", "issueIdOrKey", "issueKey"];
const UPDATE_TARGET_KEYS = ["id", "issueId", "issue_id", "issue", "number", "issue_number", "issueNumber", "issueIdOrKey", "issueKey"];
const COMMENT_FOREIGN_PARENTS = ["projectId", "initiativeId", "documentId", "milestoneId", "statusUpdateId"];
const UPDATE_ALLOWED_KEYS = new Set([
  ...UPDATE_TARGET_KEYS,
  "owner",
  "repo",
  "method",
  "state",
  "stateId",
  "status",
  "state_reason",
  "stateReason",
  "assignee",
  "assigneeId",
  "assignees",
  "links",
  "cloudId",
  "transition",
]);
/** GitHub `state_reason` values that only set state; `duplicate` merges tickets. */
const STATE_REASONS = new Set(["completed", "not planned", "reopened"]);

/** `mcp__<server>__<name>` split, or null for any other tool name. */
export function mcpToolParts(toolName: string): { server: string; name: string } | null {
  if (!toolName.startsWith("mcp__")) return null;
  const rest = toolName.slice("mcp__".length);
  const sep = rest.indexOf("__");
  if (sep <= 0) return null;
  return { server: rest.slice(0, sep), name: rest.slice(sep + 2) };
}

/**
 * True for a tracker tool: every tool of a server whose name contains
 * `linear`, `jira`, `youtrack`, `shortcut`, `clickup` or `asana`, and a tool
 * of a server containing `github`, `gitlab` or `atlassian` whose name contains
 * `issue`, `label`, `project`, `milestone` or `jira`.
 */
export function isTrackerTool(server: string, name: string): boolean {
  const s = server.toLowerCase();
  const n = name.toLowerCase();
  if (/linear|jira|youtrack|shortcut|clickup|asana/.test(s)) return true;
  return /github|gitlab|atlassian/.test(s) && /issue|label|project|milestone|jira/.test(n);
}

const READ_VERB = "get|list|search|extract|fetch|find|query|lookup";

/**
 * True for a read: a name starting with a read verb and `_` (`get_issue`) or a
 * capital (`getJiraIssue`), or ending with `_read`.
 */
export function isTrackerRead(name: string): boolean {
  return new RegExp(`^(${READ_VERB})_`, "i").test(name) || new RegExp(`^(${READ_VERB})[A-Z]`).test(name) || name.toLowerCase().endsWith("_read");
}

/** Whether an input key holds a value. */
function present(input: Record<string, unknown>, key: string): boolean {
  const value = input[key];
  return value !== undefined && value !== null && value !== "";
}

/**
 * The target an MCP input names under the first present key of `keys`. A
 * number or `#N` is a GitHub issue in the repo the `owner` and `repo` keys
 * name; a ref that names its own repo must agree with them. A UUID is reported
 * as such, so the reason can ask for the key instead.
 */
function mcpTarget(input: Record<string, unknown>, keys: readonly string[]): GuardTarget | null {
  const key = keys.find((k) => present(input, k));
  if (key === undefined) return null;
  const value = input[key];
  const owner = typeof input.owner === "string" ? input.owner : null;
  const repoName = typeof input.repo === "string" ? input.repo : null;
  const repo = owner !== null && repoName !== null ? `${owner}/${repoName}`.toLowerCase() : null;
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? { tracker: "github", repo, number: value } : { tracker: "unknown" };
  if (typeof value !== "string") return { tracker: "unknown" };
  const text = value.trim();
  if (UUID_RE.test(text)) return { tracker: "uuid" };
  if (/^#?[1-9][0-9]*$/.test(text)) return { tracker: "github", repo, number: Number(text.replace(/^#/, "")) };
  const ref = parseTicketRef(text, null);
  if (ref === null) return { tracker: "unknown" };
  if (ref.tracker === "github" && ref.number !== null) {
    const named = ref.repo?.toLowerCase() ?? null;
    if (named !== null && repo !== null && named !== repo) return { tracker: "unknown" };
    return { tracker: "github", repo: named ?? repo, number: ref.number };
  }
  return { tracker: "key", key: ref.id };
}

/**
 * Null when `target` is the own ticket; otherwise the denial. `ending` is
 * appended to a scope denial (the pull request hint for a GitHub comment).
 */
function judgeTarget(own: OwnTicket | null, toolName: string, target: GuardTarget | null, ending = ""): GuardDecision | null {
  const tail = ending === "" ? "" : ` ${ending}`;
  if (target === null) return scopeDenial(own, `${refused(`${toolName} with no ticket named`)}${tail}`);
  if (target.tracker === "uuid") return deny(rUuid(own));
  if (!isOwn(own, target)) return scopeDenial(own, `${refused(toolName)}${tail}`);
  return null;
}

/**
 * A manager's tracker write. Allowed only in one of these shapes, on its own
 * ticket: a new comment (no `id` or `commentId`, no parent other than the
 * issue or a reply's `parentId`); an attachment, and `prepare_file_upload`,
 * which only uploads the file an attachment then links; an issue update or a
 * workflow transition (`transitionJiraIssue`) whose every key is a target,
 * owner, repo, method, state, transition or assignee key, with a
 * `state_reason` that only sets state (not `duplicate`). Everything else is
 * denied, naming the tool or the first refused key.
 */
function decideManagerMcp(own: OwnTicket | null, toolName: string, name: string, input: Record<string, unknown>): GuardDecision {
  const n = name.toLowerCase();
  const isDelete = n.startsWith("delete_");

  if (n === "prepare_file_upload") return ALLOW;
  if (n.includes("comment") && !isDelete) {
    if (input.id !== undefined || input.commentId !== undefined) return scopeDenial(own, refused(`${toolName} editing an existing comment`));
    const foreign = COMMENT_FOREIGN_PARENTS.find((k) => present(input, k));
    if (foreign !== undefined) return scopeDenial(own, refused(foreign));
    const prHint = toolName.toLowerCase().includes("github") ? PR_COMMENT : "";
    return judgeTarget(own, toolName, mcpTarget(input, COMMENT_TARGET_KEYS), prHint) ?? ALLOW;
  }
  if (n.includes("attachment") && !isDelete) {
    return judgeTarget(own, toolName, mcpTarget(input, ATTACHMENT_TARGET_KEYS)) ?? ALLOW;
  }
  const hasTarget = UPDATE_TARGET_KEYS.some((k) => present(input, k));
  const isUpdate =
    n === "update_issue" ||
    (n === "save_issue" && hasTarget) ||
    (n === "issue_write" && hasTarget && input.method === "update") ||
    (n.startsWith("transition") && hasTarget);
  if (isUpdate) {
    const verdict = judgeTarget(own, toolName, mcpTarget(input, UPDATE_TARGET_KEYS));
    if (verdict !== null) return verdict;
    const bad = Object.keys(input).find((k) => !UPDATE_ALLOWED_KEYS.has(k));
    if (bad !== undefined) return scopeDenial(own, refused(bad));
    const reason = input.state_reason ?? input.stateReason;
    if (present(input, "state_reason") || present(input, "stateReason")) {
      const value = String(reason).trim().toLowerCase().replace(/_/g, " ");
      if (!STATE_REASONS.has(value)) return scopeDenial(own, refused(`state_reason ${String(reason)}`));
    }
    return ALLOW;
  }
  return scopeDenial(own, refused(toolName));
}

function decideMcp(role: "manager" | "child", own: OwnTicket | null, toolName: string, toolInput: unknown): GuardDecision {
  const parts = mcpToolParts(toolName);
  if (parts === null || !isTrackerTool(parts.server, parts.name) || isTrackerRead(parts.name)) return ALLOW;
  if (role === "child") return deny(`${R_CHILD_TRACKER} ${refused(toolName)}`);
  const input = toolInput !== null && typeof toolInput === "object" ? (toolInput as Record<string, unknown>) : {};
  return decideManagerMcp(own, toolName, parts.name, input);
}

/**
 * The decision for one PreToolUse call. Triage and sessions with no role pass.
 * For a manager or child: start-ticket through Skill or SlashCommand, by
 * either name, is denied; a Bash command that could reach the tracker must be
 * one plain command in an allowed form (`decideBash`); tracker MCP writes are
 * denied for a child and allowed for a manager only as a new comment or reply,
 * an attachment or a state and assignee update on its own ticket. Every other
 * call passes.
 */
export function decide(input: GuardInput): GuardDecision {
  const { role, own, toolName, toolInput } = input;
  if (role === null || role === "triage") return ALLOW;
  if (toolName === "Skill" || toolName === "SlashCommand") {
    const name = invokedName(toolInput);
    return name !== null && START_TICKET.has(name) ? deny(R_LAUNCH) : ALLOW;
  }
  if (toolName === "Bash") return decideBash(role, own, toolInput);
  if (toolName.startsWith("mcp__")) return decideMcp(role, own, toolName, toolInput);
  return ALLOW;
}
