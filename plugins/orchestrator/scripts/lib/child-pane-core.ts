// Pure core of child-pane.ts: the argument parser, the registry of a manager's
// child panes, and the rules for who is in a tab and who runs in a pane. No IO:
// nothing here reads the clock, the environment, the filesystem or herdr.

import { type LivePanes, isRecord, parseJson } from "./pane-layout.ts";
import { type Colour, parseArgs } from "./window.ts";

export const SEND_KEYS = ["enter", "escape", "up", "down", "left", "right", "tab", "backspace", "space", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
export type SendKey = (typeof SEND_KEYS)[number];

const WAIT_UNTIL = ["up", "detected", "idle", "working", "blocked", "done"] as const;
export type WaitUntil = (typeof WAIT_UNTIL)[number];

export type ChildPaneCommand =
  | {
      cmd: "open";
      name: string;
      colour: Colour;
      dir?: string;
      ticket?: string;
      ticketUrl?: string;
      model?: string;
      effort?: string;
      launch?: string;
      pastLimit: boolean;
      noWait: boolean;
    }
  | { cmd: "wait"; pane: string; until?: WaitUntil; patterns?: string[]; timeoutMs: number }
  /** `promptFile` "-" reads standard input. */
  | { cmd: "prompt"; pane: string; promptFile: string }
  | { cmd: "send"; pane: string; text?: string; textFile?: string; key?: SendKey }
  | { cmd: "trust"; pane: string }
  | { cmd: "retype"; pane: string }
  | { cmd: "read"; pane: string; lines: number }
  | { cmd: "list" }
  | { cmd: "close"; pane: string; force: boolean }
  | { cmd: "layout" };

export type ChildPaneParse = { ok: true; command: ChildPaneCommand } | { ok: false; error: string };

const USAGE = "usage: child-pane.ts open|wait|prompt|send|trust|retype|read|list|close|layout [flags]; see the script's header";

const DEFAULT_WAIT_MS = 60_000;
const MIN_WAIT_MS = 1_000;
const MAX_WAIT_MS = 110_000;
const DEFAULT_READ_LINES = 60;
const MAX_READ_LINES = 500;

const PANE_RE = /^\S+$/;

type FlagSpec = { values?: readonly string[]; booleans?: readonly string[]; repeats?: readonly string[] };
type Flags = { values: Map<string, string>; booleans: Set<string>; repeats: Map<string, string[]> };

function readFlags(argv: readonly string[], spec: FlagSpec): { ok: true; flags: Flags } | { ok: false; error: string } {
  const flags: Flags = { values: new Map(), booleans: new Set(), repeats: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (!token.startsWith("--")) return { ok: false, error: `unexpected argument ${JSON.stringify(token)}` };
    const flag = token.slice(2);
    if (spec.booleans?.includes(flag)) {
      if (flags.booleans.has(flag)) return { ok: false, error: `--${flag} given more than once` };
      flags.booleans.add(flag);
      continue;
    }
    const repeats = spec.repeats?.includes(flag) === true;
    if (!repeats && !spec.values?.includes(flag)) return { ok: false, error: `unknown flag ${JSON.stringify(token)}` };
    const value = argv[i + 1];
    if (value === undefined) return { ok: false, error: `--${flag} needs a value` };
    i++;
    if (repeats) {
      flags.repeats.set(flag, [...(flags.repeats.get(flag) ?? []), value]);
      continue;
    }
    const key = flag === "color" ? "colour" : flag;
    if (flags.values.has(key)) return { ok: false, error: `--${flag} given more than once` };
    flags.values.set(key, value);
  }
  return { ok: true, flags };
}

function paneOf(flags: Flags): { ok: true; pane: string } | { ok: false; error: string } {
  const pane = flags.values.get("pane");
  if (pane === undefined) return { ok: false, error: "--pane is required" };
  if (!PANE_RE.test(pane)) return { ok: false, error: `invalid pane ${JSON.stringify(pane)}` };
  return { ok: true, pane };
}

function intIn(flag: string, text: string, min: number, max: number): { ok: true; value: number } | { ok: false; error: string } {
  const value = /^[0-9]+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) return { ok: false, error: `invalid --${flag} ${JSON.stringify(text)}: an integer from ${min} to ${max}` };
  return { ok: true, value };
}

// Every field of `open` becomes a flag of `--print-line`, so the launcher's own
// parser judges them and the two cannot accept different values.
function parseOpen(flags: Flags): ChildPaneParse {
  const pairs: [string, string | undefined][] = [
    ["--name", flags.values.get("name")],
    ["--colour", flags.values.get("colour")],
    ["--dir", flags.values.get("dir")],
    ["--ticket", flags.values.get("ticket")],
    ["--ticket-url", flags.values.get("ticket-url")],
    ["--model", flags.values.get("model")],
    ["--effort", flags.values.get("effort")],
    ["--launch", flags.values.get("launch")],
  ];
  const line = parseArgs(["--print-line", ...pairs.flatMap(([flag, value]) => (value === undefined ? [] : [flag, value]))], {});
  if (!line.ok) return line;
  if (line.args.mode !== "print-line") return { ok: false, error: "--print-line was not read" };
  const { mode: _mode, ...fields } = line.args;
  return { ok: true, command: { cmd: "open", ...fields, pastLimit: flags.booleans.has("past-limit"), noWait: flags.booleans.has("no-wait") } };
}

function parseWait(flags: Flags, pane: string): ChildPaneParse {
  const until = flags.values.get("until");
  const patterns = flags.repeats.get("pattern");
  if (until !== undefined && patterns !== undefined) return { ok: false, error: "--until and --pattern cannot be combined" };
  if (until !== undefined && !(WAIT_UNTIL as readonly string[]).includes(until)) {
    return { ok: false, error: `invalid --until ${JSON.stringify(until)}; one of: ${WAIT_UNTIL.join(" ")}` };
  }
  for (const pattern of patterns ?? []) {
    if (pattern === "" || pattern.includes("\n")) return { ok: false, error: `invalid --pattern ${JSON.stringify(pattern)}: non-empty, with no newline` };
  }
  const timeoutText = flags.values.get("timeout-ms");
  let timeoutMs = DEFAULT_WAIT_MS;
  if (timeoutText !== undefined) {
    const parsed = intIn("timeout-ms", timeoutText, MIN_WAIT_MS, MAX_WAIT_MS);
    if (!parsed.ok) return parsed;
    timeoutMs = parsed.value;
  }
  if (patterns !== undefined) return { ok: true, command: { cmd: "wait", pane, patterns, timeoutMs } };
  return { ok: true, command: { cmd: "wait", pane, until: (until ?? "up") as WaitUntil, timeoutMs } };
}

function parseSend(flags: Flags, pane: string): ChildPaneParse {
  const text = flags.values.get("text");
  const textFile = flags.values.get("text-file");
  const keyText = flags.values.get("key");
  if (text !== undefined && textFile !== undefined) return { ok: false, error: "--text and --text-file cannot be combined" };
  if (text === undefined && textFile === undefined && keyText === undefined) return { ok: false, error: "send needs --text, --text-file or --key" };
  if (text === "" || textFile === "") return { ok: false, error: `--${text === "" ? "text" : "text-file"} needs a value` };
  const key = keyText?.toLowerCase();
  if (key !== undefined && !(SEND_KEYS as readonly string[]).includes(key)) {
    return { ok: false, error: `invalid --key ${JSON.stringify(keyText)}; one of: ${SEND_KEYS.join(" ")}` };
  }
  return {
    ok: true,
    command: {
      cmd: "send",
      pane,
      ...(text !== undefined ? { text } : {}),
      ...(textFile !== undefined ? { textFile } : {}),
      ...(key !== undefined ? { key: key as SendKey } : {}),
    },
  };
}

const SPECS: Readonly<Record<ChildPaneCommand["cmd"], FlagSpec>> = {
  open: { values: ["name", "colour", "color", "dir", "ticket", "ticket-url", "model", "effort", "launch"], booleans: ["past-limit", "no-wait"] },
  wait: { values: ["pane", "until", "timeout-ms"], repeats: ["pattern"] },
  prompt: { values: ["pane", "prompt-file"] },
  send: { values: ["pane", "text", "text-file", "key"] },
  trust: { values: ["pane"] },
  retype: { values: ["pane"] },
  read: { values: ["pane", "lines"] },
  list: {},
  close: { values: ["pane"], booleans: ["force"] },
  layout: {},
};

function isCommandName(word: string): word is ChildPaneCommand["cmd"] {
  return Object.hasOwn(SPECS, word);
}

function parseCommand(argv: readonly string[]): ChildPaneParse {
  const [cmd, ...rest] = argv;
  if (cmd === undefined) return { ok: false, error: "a command is required" };
  if (!isCommandName(cmd)) return { ok: false, error: `unknown command ${JSON.stringify(cmd)}` };
  const read = readFlags(rest, SPECS[cmd]);
  if (!read.ok) return read;
  const { flags } = read;
  if (cmd === "open") return parseOpen(flags);
  if (cmd === "list" || cmd === "layout") return { ok: true, command: { cmd } };
  const named = paneOf(flags);
  if (!named.ok) return named;
  const { pane } = named;
  switch (cmd) {
    case "wait":
      return parseWait(flags, pane);
    case "prompt": {
      const promptFile = flags.values.get("prompt-file");
      if (promptFile === undefined || promptFile === "") return { ok: false, error: "--prompt-file is required" };
      return { ok: true, command: { cmd, pane, promptFile } };
    }
    case "send":
      return parseSend(flags, pane);
    case "trust":
    case "retype":
      return { ok: true, command: { cmd, pane } };
    case "read": {
      const parsed = intIn("lines", flags.values.get("lines") ?? String(DEFAULT_READ_LINES), 1, MAX_READ_LINES);
      return parsed.ok ? { ok: true, command: { cmd, pane, lines: parsed.value } } : parsed;
    }
    case "close":
      return { ok: true, command: { cmd, pane, force: flags.booleans.has("force") } };
  }
}

/** `argv` is what follows the script path. An error ends with a usage line. Never throws. */
export function parseChildPaneArgs(argv: readonly string[]): ChildPaneParse {
  const parsed = parseCommand(argv);
  return parsed.ok ? parsed : { ok: false, error: `${parsed.error}\n${USAGE}` };
}

// --- the registry -------------------------------------------------------------------------

/**
 * One child pane this manager opened. `terminal` is the witness: herdr's
 * terminal id of the pane at split time. `line` is the launch line, kept so it
 * can be typed again.
 */
export interface PaneEntry {
  pane: string;
  terminal: string;
  name: string;
  claim: string;
  dir: string;
  line: string;
  openedAt: number;
}

/** A child that left the registry: closed by `close`, or found gone by a mutating command. */
export interface EndedEntry {
  pane: string;
  name: string;
  at: number;
  how: "closed" | "gone";
}

export interface PanesFile {
  schema: 1;
  manager: string;
  main: string;
  mainTerminal: string;
  children: PaneEntry[];
  /** Newest last, at most 20. */
  ended: EndedEntry[];
}

export const MAX_ENDED = 20;

function isPaneEntry(value: unknown): value is PaneEntry {
  if (!isRecord(value)) return false;
  const { pane, terminal, name, claim, dir, line, openedAt } = value;
  return (
    typeof pane === "string" &&
    typeof terminal === "string" &&
    typeof name === "string" &&
    typeof claim === "string" &&
    typeof dir === "string" &&
    typeof line === "string" &&
    typeof openedAt === "number" &&
    Number.isFinite(openedAt)
  );
}

function isEndedEntry(value: unknown): value is EndedEntry {
  if (!isRecord(value)) return false;
  const { pane, name, at, how } = value;
  return typeof pane === "string" && typeof name === "string" && typeof at === "number" && Number.isFinite(at) && (how === "closed" || how === "gone");
}

/** Null for no text, malformed text, or any schema but 1. Never throws. */
export function parsePanesFile(text: string | null): PanesFile | null {
  if (text === null) return null;
  const data = parseJson(text);
  if (!isRecord(data) || data.schema !== 1) return null;
  const { manager, main, mainTerminal, children, ended } = data;
  if (typeof manager !== "string" || typeof main !== "string" || typeof mainTerminal !== "string") return null;
  if (!Array.isArray(children) || !children.every(isPaneEntry)) return null;
  if (!Array.isArray(ended) || !ended.every(isEndedEntry)) return null;
  return { schema: 1, manager, main, mainTerminal, children, ended };
}

export function serializePanesFile(file: PanesFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Judges each entry by its witness: it is live only while herdr lists its pane
 * id with the same terminal id, because pane ids repeat after a herdr restart.
 * Dead entries move to `ended` as gone. A file of another manager counts as no
 * file.
 */
export function reconcile(
  file: PanesFile | null,
  live: LivePanes,
  manager: string,
  main: string,
  mainTerminal: string,
  now: number,
): { file: PanesFile; live: PaneEntry[]; gone: PaneEntry[] } {
  const known = file !== null && file.manager === manager ? file : null;
  const entries = known?.children ?? [];
  const alive = entries.filter((entry) => live.get(entry.pane) === entry.terminal);
  const gone = entries.filter((entry) => live.get(entry.pane) !== entry.terminal);
  const ended = [...(known?.ended ?? []), ...gone.map((entry): EndedEntry => ({ pane: entry.pane, name: entry.name, at: now, how: "gone" }))].slice(-MAX_ENDED);
  return { file: { schema: 1, manager, main, mainTerminal, children: alive, ended }, live: alive, gone };
}

// --- who is in the tab --------------------------------------------------------------------

/** The array under `field` of a version-1 document; absent counts as empty. Null when the document is anything else. */
function versionedList(text: string, field: string): unknown[] | null {
  const data = parseJson(text);
  if (!isRecord(data) || data.version !== 1) return null;
  const list = data[field] ?? [];
  return Array.isArray(list) ? list : null;
}

/**
 * The terminal slots this manager opened, from tmux-mcp's herdr registry and
 * the layout store beside it. A slot counts when herdr witnesses it (same
 * terminal id), tmux-mcp opened it for an agent (owner "agent"), and its stamp
 * names `main` for the same pane and terminal. Null when there is no registry;
 * an absent layout store means no stamps; "unreadable" when a present file
 * does not parse or is not version 1. Never throws.
 */
export function parseSlotRegistry(registryText: string | null, layoutText: string | null, live: LivePanes, main: string): Set<string> | null | "unreadable" {
  if (registryText === null) return null;
  const panes = versionedList(registryText, "panes");
  const stamps = layoutText === null ? [] : versionedList(layoutText, "agents");
  if (panes === null || stamps === null) return "unreadable";
  const slots = new Set<string>();
  for (const record of panes) {
    if (!isRecord(record) || record.owner !== "agent" || typeof record.pane_id !== "string") continue;
    const { pane_id: pane, terminal_id: terminal } = record;
    if (typeof terminal !== "string" || live.get(pane) !== terminal) continue;
    const stamped = stamps.some((stamp) => isRecord(stamp) && stamp.pane_id === pane && stamp.terminal_id === terminal && stamp.agent_pane_id === main);
    if (stamped) slots.add(pane);
  }
  return slots;
}

/** Splits a tab's tree-ordered panes into the manager's family and the rest. */
export function familyOf(
  tabPanes: readonly string[],
  main: string,
  children: readonly PaneEntry[],
  slots: ReadonlySet<string>,
): { members: string[]; children: string[]; slots: string[]; foreign: string[]; lastFamilyPane: string } {
  const childPanes = new Set(children.map((entry) => entry.pane));
  const isMember = (pane: string): boolean => pane === main || childPanes.has(pane) || slots.has(pane);
  const members = tabPanes.filter(isMember);
  return {
    members,
    children: tabPanes.filter((pane) => childPanes.has(pane)),
    slots: tabPanes.filter((pane) => slots.has(pane) && !childPanes.has(pane) && pane !== main),
    foreign: tabPanes.filter((pane) => !isMember(pane)),
    lastFamilyPane: members[members.length - 1] ?? main,
  };
}

// --- who runs in a pane -------------------------------------------------------------------

/** Which state a child pane's occupant is in, from `agent get` and the child's record. */
export type Occupant = "child" | "none" | "other-agent" | "unbound";

/**
 * "none" with no agent session. With a record bound to the claim: "child" when
 * the session is the record's current or a previous id, else "other-agent".
 * With no record: "other-agent" when the store knows that session under another
 * key, else "unbound" (a Claude Code that has not bound this claim yet, or one
 * started by hand).
 */
export function occupantOf(agentSession: string | null, record: { sessionId: string; previousIds: string[] } | null, knownElsewhere: boolean): Occupant {
  if (agentSession === null) return "none";
  if (record !== null) return agentSession === record.sessionId || record.previousIds.includes(agentSession) ? "child" : "other-agent";
  return knownElsewhere ? "other-agent" : "unbound";
}

/** True when the pane's shell itself is in the foreground: at least one foreground pid, and all of them the shell's. */
export function shellInForeground(procs: { shellPid: number; foregroundPids: number[] }): boolean {
  return procs.foregroundPids.length > 0 && procs.foregroundPids.every((pid) => pid === procs.shellPid);
}

/** The escaped Rust-regex alternation for literal patterns. */
export function alternationRegex(patterns: readonly string[]): string {
  return patterns.map((pattern) => pattern.replace(/[.()[\]*+?|\\^${}]/g, "\\$&")).join("|");
}

/** The agent `herdr agent get` reports. Null when the answer carries no named agent. */
export function parseAgentInfo(answer: unknown): { agent: string; session: string | null; status: string | null } | null {
  if (!isRecord(answer) || !isRecord(answer.result) || !isRecord(answer.result.agent)) return null;
  const info = answer.result.agent;
  if (typeof info.agent !== "string" || info.agent === "") return null;
  const value = isRecord(info.agent_session) ? info.agent_session.value : null;
  return {
    agent: info.agent,
    session: typeof value === "string" && value !== "" ? value : null,
    status: typeof info.agent_status === "string" && info.agent_status !== "" ? info.agent_status : null,
  };
}
