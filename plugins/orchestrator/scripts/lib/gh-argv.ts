// Pure shell and `gh` reading for the guard: a Bash command with the heredoc
// bodies it only feeds as data removed, the words it could run, its segments,
// each segment's command word, and a `gh` segment normalised into its group,
// verb, refs, repo and flags. No IO and no imports.
//
// This reads a command the way a discipline guard needs, not the way a shell
// runs it. The guard never tries to see through `$(…)`, `eval`, `sh -c` or a
// wrapper: it finds the words a command could run (`commandWords`), and a
// command naming `gh` or the launcher must then be one plain command it can
// read (`shellSegments` gives exactly one segment, no word marked `expanded`).

/** One shell word with its quotes removed. */
export type ShellToken = {
  text: string;
  /** True when the word holds `$…`, `$(…)` or a backtick outside single quotes. */
  expanded: boolean;
};

/** The words of one segment: a command between `;`, `&&`, `||`, `|`, `&`, `(`, `)` or a newline. */
export type ShellSegment = { tokens: ShellToken[] };

const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** True when `text` is a `NAME=value` assignment word. */
export function isAssignment(text: string): boolean {
  return ASSIGNMENT_RE.test(text);
}

/** The last path component of a word: `…/scripts/ticket-window.ts` → `ticket-window.ts`. */
export function basename(text: string): string {
  const slash = text.lastIndexOf("/");
  return slash === -1 ? text : text.slice(slash + 1);
}

/**
 * Splits a shell command into segments of words. Quotes are removed (`'…'`
 * literal, `"…"` with `\"`, `\\`, `\$` and `` \` `` escapes, `\x` outside
 * quotes), a `#` that starts a word comments out the rest of its line, and a
 * redirection (`>`, `>>`, `<`, `<<`, `2>&1`, `&>`) is dropped together with its
 * target. `$(…)` and backticks are kept inside their word, which is marked
 * `expanded`. Never throws.
 */
export function shellSegments(command: string): ShellSegment[] {
  return readShell(command).segments;
}

/**
 * The files a command writes by output redirection (`> f`, `>> f`, `>| f`,
 * `&> f`), each as written with its quotes removed. Input redirections and
 * heredoc delimiters are not included.
 */
export function redirectTargets(command: string): string[] {
  return readShell(command).written;
}

function readShell(command: string): { segments: ShellSegment[]; written: string[] } {
  const segments: ShellSegment[] = [];
  const written: string[] = [];
  let tokens: ShellToken[] = [];
  let text = "";
  let inWord = false;
  let expanded = false;
  let skipNextWord = false;
  let skippedIsOutput = false;

  const endWord = (): void => {
    if (inWord) {
      if (skipNextWord) {
        skipNextWord = false;
        if (skippedIsOutput) written.push(text);
      } else tokens.push({ text, expanded });
    }
    text = "";
    inWord = false;
    expanded = false;
  };
  const endSegment = (): void => {
    endWord();
    skipNextWord = false;
    if (tokens.length > 0) segments.push({ tokens });
    tokens = [];
  };

  /** Copies a `$(…)` or a backtick span starting at `i` into the word; returns the index after it. */
  const copySubstitution = (i: number): number => {
    expanded = true;
    inWord = true;
    if (command[i] === "`") {
      let j = i + 1;
      while (j < command.length && command[j] !== "`") j += command[j] === "\\" ? 2 : 1;
      text += command.slice(i, Math.min(j + 1, command.length));
      return j + 1;
    }
    let depth = 0;
    let j = i + 1;
    for (; j < command.length; j++) {
      const c = command[j];
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) break;
      } else if (c === "'") {
        const close = command.indexOf("'", j + 1);
        j = close === -1 ? command.length : close;
      } else if (c === "\\") j++;
    }
    text += command.slice(i, Math.min(j + 1, command.length));
    return j + 1;
  };

  let i = 0;
  while (i < command.length) {
    const c = command[i] as string;
    const next = command[i + 1];

    if (c === "'") {
      const close = command.indexOf("'", i + 1);
      const end = close === -1 ? command.length : close;
      text += command.slice(i + 1, end);
      inWord = true;
      i = end + 1;
      continue;
    }
    if (c === '"') {
      inWord = true;
      let j = i + 1;
      while (j < command.length && command[j] !== '"') {
        const d = command[j] as string;
        if (d === "\\" && j + 1 < command.length && '"\\$`\n'.includes(command[j + 1] as string)) {
          text += command[j + 1];
          j += 2;
          continue;
        }
        if (d === "$" && command[j + 1] === "(") {
          j = copySubstitution(j);
          continue;
        }
        if (d === "`") {
          j = copySubstitution(j);
          continue;
        }
        if (d === "$" && /[A-Za-z_{0-9@*#?!$-]/.test(command[j + 1] ?? "")) expanded = true;
        text += d;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "\\") {
      if (next === "\n") {
        i += 2;
        continue;
      }
      if (next !== undefined) text += next;
      inWord = true;
      i += 2;
      continue;
    }
    if (c === "$" && next === "(") {
      i = copySubstitution(i);
      continue;
    }
    if (c === "`") {
      i = copySubstitution(i);
      continue;
    }
    if (c === "$" && /[A-Za-z_{0-9@*#?!$-]/.test(next ?? "")) {
      expanded = true;
      text += c;
      inWord = true;
      i++;
      continue;
    }
    if (c === "#" && !inWord) {
      const eol = command.indexOf("\n", i);
      i = eol === -1 ? command.length : eol;
      continue;
    }
    if (c === "\n" || c === ";" || c === "(" || c === ")") {
      endSegment();
      i++;
      continue;
    }
    if (c === "|" || c === "&") {
      if (c === "&" && next === ">") {
        // `&>` / `&>>`: redirect both streams; the target is dropped.
        endWord();
        i += command[i + 2] === ">" ? 3 : 2;
        skipNextWord = true;
        skippedIsOutput = true;
        continue;
      }
      endSegment();
      i += next === c ? 2 : 1;
      continue;
    }
    if (c === ">" || c === "<") {
      // A digit-only word just before a redirection is its file descriptor.
      if (inWord && /^\d+$/.test(text) && !expanded) {
        text = "";
        inWord = false;
      } else {
        endWord();
      }
      let j = i + 1;
      while (command[j] === ">" || command[j] === "<" || command[j] === "|") j++;
      if (command[j] === "&") {
        j++;
        while (j < command.length && /[0-9-]/.test(command[j] as string)) j++;
        i = j;
        continue;
      }
      // `<<-EOF`: the dash belongs to the operator, not to the delimiter word.
      if (command.startsWith("<<-", i)) j = i + 3;
      skippedIsOutput = c === ">";
      i = j;
      skipNextWord = true;
      continue;
    }
    if (/\s/.test(c)) {
      endWord();
      i++;
      continue;
    }
    text += c;
    inWord = true;
    i++;
  }
  endSegment();
  return { segments, written };
}

// --- command word -------------------------------------------------------------------

/** Runtime flags of `bun` and `node` that take the next word as their value. */
const RUNTIME_VALUE_FLAGS = new Set([
  "--cwd",
  "--env-file",
  "--config",
  "-c",
  "--tsconfig-override",
  "-d",
  "--define",
  "-l",
  "--conditions",
  "-C",
  "--main-fields",
  "--extension-order",
  "--port",
  "--console-depth",
  "--input-type",
  "--inspect-port",
  "--title",
  "--filter",
  "-F",
]);

/**
 * Flags that make a runtime run code other than the script it names: inline
 * code (`--eval`, `--print`) or a module loaded first (`--preload`,
 * `--require`, `--import`, `--loader`). With any of them, in any spelling
 * (`--eval=…`, `-e…`), the runtime itself is the command word.
 */
const RUNTIME_CODE_FLAGS = new Set(["-e", "--eval", "-p", "--print", "-r", "--preload", "--require", "--import", "--loader", "--experimental-loader"]);

/** True when a runtime flag word runs code other than the named script. */
export function isRuntimeCodeFlag(word: string): boolean {
  const eq = word.indexOf("=");
  const name = word.startsWith("--") && eq !== -1 ? word.slice(0, eq) : word;
  if (RUNTIME_CODE_FLAGS.has(name)) return true;
  // `-e'code'`, `-p1`, `-r./x.ts`: a short code flag with its value attached.
  return /^-[epr]./.test(word) && !word.startsWith("--");
}

/** True when an `env` flag word splits its value into a command (`-S`, `--split-string`, `-iS`). */
function isEnvSplitFlag(word: string): boolean {
  if (word === "--split-string" || word.startsWith("--split-string=")) return true;
  return /^-[^-]*S/.test(word);
}

/** `bun` subcommands that are not a script run: the command word stays `bun`. */
const BUN_SUBCOMMANDS = new Set([
  "test",
  "x",
  "build",
  "install",
  "i",
  "add",
  "a",
  "remove",
  "rm",
  "update",
  "outdated",
  "link",
  "unlink",
  "pm",
  "init",
  "create",
  "upgrade",
  "publish",
  "repl",
  "exec",
  "patch",
  "audit",
  "why",
  "info",
]);

/**
 * The index of a segment's command word, or -1 when it has none (only
 * assignments, or a `command -v` probe). Skipped, each with its own flags:
 * leading `NAME=value` assignments, `exec`, `command`, `env` (with its own
 * assignments; `/usr/bin/env` too), and a `bun` or `node` runtime (`bun run`
 * included). `bun test`, `bun x` and the other `bun` subcommands are not
 * unwrapped, so their command word is `bun`. An `env` that splits a string
 * into a command (`-S`) is itself the command word, and so is a runtime given
 * a flag that runs other code (`isRuntimeCodeFlag`).
 */
export function commandWordIndex(tokens: readonly ShellToken[]): number {
  let i = 0;
  while (i < tokens.length && isAssignment(tokens[i]?.text ?? "")) i++;
  for (;;) {
    const raw = tokens[i]?.text;
    if (raw === undefined) return -1;
    const word = basename(raw);
    if (word === "exec") {
      i++;
      while ((tokens[i]?.text ?? "").startsWith("-")) i += tokens[i]?.text === "-a" ? 2 : 1;
      continue;
    }
    if (word === "command") {
      i++;
      while ((tokens[i]?.text ?? "").startsWith("-")) {
        const flag = tokens[i]?.text ?? "";
        if (flag.includes("v") || flag.includes("V")) return -1;
        i++;
      }
      continue;
    }
    if (word === "env") {
      const at = i;
      i++;
      for (;;) {
        const t = tokens[i]?.text ?? "";
        if (isEnvSplitFlag(t)) return at;
        if (t === "-u" || t === "-C" || t === "-P" || t === "--unset" || t === "--chdir") i += 2;
        else if (t.startsWith("-") || isAssignment(t)) i++;
        else break;
      }
      continue;
    }
    if (word === "bun" || word === "node") {
      let j = i + 1;
      const skipFlags = (): boolean => {
        for (;;) {
          const t = tokens[j]?.text ?? "";
          if (!t.startsWith("-") || t === "-") return false;
          if (isRuntimeCodeFlag(t)) return true;
          j += RUNTIME_VALUE_FLAGS.has(t) ? 2 : 1;
        }
      };
      if (skipFlags()) return i;
      const sub = tokens[j]?.text;
      if (word === "bun" && sub === "run") {
        j++;
        if (skipFlags()) return i;
      } else if (word === "bun" && sub !== undefined && BUN_SUBCOMMANDS.has(sub)) {
        return i;
      }
      return j < tokens.length ? j : i;
    }
    return i;
  }
}

// --- heredocs ---------------------------------------------------------------------

/** Commands that read their standard input as data and never run it. */
const DATA_READERS = new Set(["cat", "tee", "gh", "git", "grep", "egrep", "fgrep", "rg", "wc", "head", "tail", "jq", "sort", "uniq", "diff", "tr", "cut"]);

const SCRIPT_FILE_RE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/**
 * True when the last command in `text` reads its standard input as data: a
 * command in a fixed list (`cat`, `tee`, `gh`, `git`, `grep`, …), or a `bun` or
 * `node` runtime running a script file. Anything else, a shell, `eval`,
 * `xargs` or an unknown command, may run what it reads. A command line that
 * holds a process substitution (`<(…)`, `>(…)`) is never a data reader: the
 * substitution splits the line, so its last segment need not be the command
 * that receives the input.
 */
export function readsInputAsData(text: string): boolean {
  if (/[<>]\(/.test(withoutQuotes(text))) return false;
  const segments = shellSegments(text);
  const tokens = segments[segments.length - 1]?.tokens ?? [];
  const at = commandWordIndex(tokens);
  if (at === -1) return false;
  const word = basename(tokens[at]?.text ?? "");
  if (DATA_READERS.has(word)) return true;
  let k = 0;
  while (k < at && isAssignment(tokens[k]?.text ?? "")) k++;
  const runtime = basename(tokens[k]?.text ?? "");
  return k < at && (runtime === "bun" || runtime === "node") && SCRIPT_FILE_RE.test(word);
}

type Frame = {
  /** What closes this frame: `)` for `$(…)`, `<(…)`, `>(…)`; a backtick; null for the command itself. */
  close: ")" | "`" | null;
  /** Open `(` inside this frame. */
  depth: number;
  /** Where the current command of this frame starts. */
  cmdStart: number;
  inDouble: boolean;
  /** True when everything enclosing this frame takes its output as data. */
  data: boolean;
};

type PendingHeredoc = {
  delimiter: string;
  stripTabs: boolean;
  data: boolean;
  /** True when any part of the delimiter word was quoted: the body is then literal text. */
  quoted: boolean;
};

function withoutQuotes(text: string): string {
  return text.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "");
}

/** An unescaped `$(` or backtick: a command substitution the shell runs inside an unquoted heredoc body. */
const BODY_SUBSTITUTION_RE = /(^|[^\\])(\$\(|`)/;

/** A command with its data heredoc bodies removed, and whether any heredoc body runs a command substitution. */
export type HeredocScan = {
  text: string;
  /** True when an unquoted heredoc body (`<<EOF`, `<<-EOF`) holds `$(…)` or a backtick. */
  substitutingBody: boolean;
};

/**
 * The command with the body and closing line of every heredoc that only feeds
 * data removed. A heredoc feeds data when the command it is attached to reads
 * its input as data (`readsInputAsData`), its output is not piped on, every
 * `$(…)`, backtick or `<(…)` around it is itself an argument of such a
 * command, and its body runs nothing: a body under an unquoted delimiter that
 * holds `$(…)` or a backtick is run by the shell before any command reads it,
 * so it is kept and reported as `substitutingBody`. A quoted delimiter
 * (`<<'EOF'`, `<<"EOF"`, `<<\EOF`) keeps the body literal. A heredoc fed to a
 * shell, `eval`, `xargs` or anything unknown keeps its body, which is then
 * read as commands. An unterminated heredoc keeps the rest of the text. Never
 * throws.
 */
export function scanHeredocs(command: string): HeredocScan {
  let out = "";
  let substitutingBody = false;
  const frames: Frame[] = [{ close: null, depth: 0, cmdStart: 0, inDouble: false, data: true }];
  let pending: PendingHeredoc[] = [];
  const top = (): Frame => frames[frames.length - 1] as Frame;
  const push = (close: ")" | "`", at: number, start: number): void => {
    const f = top();
    frames.push({ close, depth: 0, cmdStart: start, inDouble: false, data: f.data && readsInputAsData(command.slice(f.cmdStart, at)) });
  };

  /** Reads the pending heredoc bodies starting at `i` (just after a newline); returns the index after them. */
  const readBodies = (start: number): number => {
    let i = start;
    for (const h of pending) {
      let k = i;
      let end = -1;
      let bodyEnd = -1;
      for (;;) {
        const eol = command.indexOf("\n", k);
        const lineEnd = eol === -1 ? command.length : eol;
        const line = command.slice(k, lineEnd);
        if ((h.stripTabs ? line.replace(/^\t+/, "") : line) === h.delimiter) {
          bodyEnd = k;
          end = eol === -1 ? command.length : eol + 1;
          break;
        }
        if (eol === -1) break;
        k = eol + 1;
      }
      if (end === -1) {
        if (!h.quoted && BODY_SUBSTITUTION_RE.test(command.slice(i))) substitutingBody = true;
        out += command.slice(i);
        pending = [];
        return command.length;
      }
      const substitutes = !h.quoted && BODY_SUBSTITUTION_RE.test(command.slice(i, bodyEnd));
      if (substitutes) substitutingBody = true;
      if (!h.data || substitutes) out += command.slice(i, end);
      i = end;
    }
    pending = [];
    return i;
  };

  let i = 0;
  while (i < command.length) {
    const f = top();
    const c = command[i] as string;
    const next = command[i + 1];

    if (f.inDouble) {
      if (c === "\\") {
        out += command.slice(i, i + 2);
        i += 2;
      } else if (c === '"') {
        f.inDouble = false;
        out += c;
        i++;
      } else if (c === "$" && next === "(") {
        push(")", i, i + 2);
        out += "$(";
        i += 2;
      } else if (c === "`") {
        push("`", i, i + 1);
        out += c;
        i++;
      } else {
        out += c;
        i++;
      }
      continue;
    }
    if (c === "\\") {
      out += command.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === "'") {
      const close = command.indexOf("'", i + 1);
      const end = close === -1 ? command.length : close + 1;
      out += command.slice(i, end);
      i = end;
      continue;
    }
    if (c === '"') {
      f.inDouble = true;
      out += c;
      i++;
      continue;
    }
    if (c === "#" && (i === 0 || /[\s;&|()]/.test(command[i - 1] as string))) {
      const eol = command.indexOf("\n", i);
      const end = eol === -1 ? command.length : eol;
      out += command.slice(i, end);
      i = end;
      continue;
    }
    if ((c === "$" || c === "<" || c === ">") && next === "(") {
      push(")", i, i + 2);
      out += command.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === "`") {
      if (f.close === "`") frames.pop();
      else push("`", i, i + 1);
      out += c;
      i++;
      continue;
    }
    if (c === "(") {
      f.depth++;
      f.cmdStart = i + 1;
      out += c;
      i++;
      continue;
    }
    if (c === ")") {
      if (f.close === ")" && f.depth === 0) frames.pop();
      else {
        f.depth = Math.max(0, f.depth - 1);
        f.cmdStart = i + 1;
      }
      out += c;
      i++;
      continue;
    }
    if (c === ";" || c === "&" || c === "|") {
      f.cmdStart = i + 1;
      out += c;
      i++;
      continue;
    }
    if (c === "<" && next === "<") {
      if (command[i + 2] === "<") {
        out += "<<<";
        i += 3;
        continue;
      }
      let j = i + 2;
      const stripTabs = command[j] === "-";
      if (stripTabs) j++;
      while (command[j] === " " || command[j] === "\t") j++;
      let delimiter = "";
      let quoted = false;
      while (j < command.length && !/[\s;&|()<>]/.test(command[j] as string)) {
        const d = command[j] as string;
        if (d === "'" || d === '"' || d === "\\") quoted = true;
        if (d === "'") {
          const close = command.indexOf("'", j + 1);
          const end = close === -1 ? command.length : close;
          delimiter += command.slice(j + 1, end);
          j = end + 1;
        } else if (d === '"') {
          let k = j + 1;
          while (k < command.length && command[k] !== '"') {
            if (command[k] === "\\") k++;
            delimiter += command[k] ?? "";
            k++;
          }
          j = k + 1;
        } else if (d === "\\") {
          delimiter += command[j + 1] ?? "";
          j += 2;
        } else {
          delimiter += d;
          j++;
        }
      }
      const eol = command.indexOf("\n", j);
      const restOfLine = command.slice(j, eol === -1 ? command.length : eol);
      const piped = /(^|[^|])\|(?!\|)/.test(withoutQuotes(restOfLine));
      const data = delimiter !== "" && f.data && !piped && readsInputAsData(command.slice(f.cmdStart, i));
      pending.push({ delimiter, stripTabs, data, quoted });
      out += command.slice(i, j);
      i = j;
      continue;
    }
    if (c === "\n") {
      out += c;
      i++;
      f.cmdStart = i;
      if (pending.length > 0) i = readBodies(i);
      continue;
    }
    out += c;
    i++;
  }
  return { text: out, substitutingBody };
}

/** The command with the bodies of data heredocs removed (`scanHeredocs`). */
export function stripDataHeredocs(command: string): string {
  return scanHeredocs(command).text;
}

/**
 * True when the command holds a command substitution (`$(…)`, a backtick) or
 * a process substitution (`<(…)`, `>(…)`) the shell would run: outside single
 * quotes and not escaped. Inside double quotes `$(…)` and backticks count,
 * `<(` and `>(` do not. Heredoc bodies are read like the rest of the text, so
 * pass the output of `scanHeredocs` and use its `substitutingBody` for them.
 */
export function hasSubstitution(command: string): boolean {
  let inDouble = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1];
    if (c === "\\") {
      i++;
      continue;
    }
    if (!inDouble && c === "'") {
      const close = command.indexOf("'", i + 1);
      if (close === -1) return false;
      i = close;
      continue;
    }
    if (c === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (c === "`" || (c === "$" && next === "(")) return true;
    if (!inDouble && (c === "<" || c === ">") && next === "(") return true;
  }
  return false;
}

/**
 * True when the command holds a `(` or `)` the shell reads as an operator: a
 * subshell group, a function definition or a `case` pattern. Quoted, escaped
 * and commented parentheses do not count. Meant for text that already passed
 * `hasSubstitution`, so the parentheses of `$(…)`, `<(…)` and `>(…)` count too.
 */
export function hasGroup(command: string): boolean {
  let inDouble = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string;
    if (c === "\\") {
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      continue;
    }
    if (c === "'") {
      const close = command.indexOf("'", i + 1);
      if (close === -1) return false;
      i = close;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      continue;
    }
    if (c === "#" && (i === 0 || /[\s;&|()]/.test(command[i - 1] as string))) {
      const eol = command.indexOf("\n", i);
      if (eol === -1) return false;
      i = eol;
      continue;
    }
    if (c === "(" || c === ")") return true;
  }
  return false;
}

// --- the words a command could run ---------------------------------------------------

const WORD_SPLIT_RE = /[^A-Za-z0-9_./-]+/;
const NESTED_RE = /[\s'"\\;|&$`()]/;
const NESTED_DEPTH = 3;

/**
 * Every word `text` holds, read three ways and merged: the raw text split on
 * anything but letters, digits, `_`, `.`, `/` and `-`; each shell word with its
 * quotes removed (`g''h` is `gh`); and, for a shell word holding spaces,
 * quotes, operators or a substitution, the words of that word read again as a
 * command, three levels deep (`sh -c "…"`, `eval "…"`, `$(…)`). A word that
 * only splices into a command (`$a$b`) is not resolved.
 */
export function commandWords(text: string): Set<string> {
  const out = new Set<string>();
  const addWords = (t: string): void => {
    for (const w of t.split(WORD_SPLIT_RE)) if (w !== "") out.add(w);
  };
  const visit = (t: string, depth: number): void => {
    addWords(t);
    if (depth >= NESTED_DEPTH) return;
    for (const segment of shellSegments(t)) {
      for (const token of segment.tokens) {
        addWords(token.text);
        if (NESTED_RE.test(token.text)) visit(token.text.replace(/\$\(|[`()]/g, " ; "), depth + 1);
      }
    }
  };
  visit(text, 0);
  return out;
}

// --- gh -------------------------------------------------------------------------------

/** A `gh` segment, normalised. */
export type GhSegment = {
  /** `issue`, `label`, `project`, `api`, …; null for a bare `gh`. */
  group: string | null;
  /** The subcommand (`create`, `edit`, …); for `api`, the endpoint as written. */
  verb: string | null;
  /** Every positional word after the verb; a bare positive integer is written `#N`. */
  refs: string[];
  /** The value of `-R`/`--repo`, or null; the last one when it is given twice. */
  repo: string | null;
  /** Every flag by its long name, with every value it was given (boolean flags: an empty list). */
  flags: ReadonlyMap<string, readonly string[]>;
  /** The long names of flags with a value that holds an expansion outside single quotes. */
  expanded: ReadonlySet<string>;
};

/** Flags that take the next word as their value. Every other flag is boolean. */
const GH_VALUE_FLAGS = new Set([
  "--repo",
  "--hostname",
  "--title",
  "--body",
  "--body-file",
  "--attach",
  "--label",
  "--add-label",
  "--remove-label",
  "--assignee",
  "--add-assignee",
  "--remove-assignee",
  "--milestone",
  "--project",
  "--add-project",
  "--remove-project",
  "--method",
  "--field",
  "--raw-field",
  "--input",
  "--header",
  "--jq",
  "--template",
  "--json",
  "--search",
  "--state",
  "--limit",
  "--reason",
  "--comment",
  "--duplicate-of",
  "--preview",
  "--cache",
]);

const GH_SHORT_COMMON: Readonly<Record<string, string>> = { "-R": "--repo", "-q": "--jq", "-L": "--limit", "-s": "--state", "-S": "--search" };
const GH_SHORT_API: Readonly<Record<string, string>> = {
  "-X": "--method",
  "-f": "--raw-field",
  "-F": "--field",
  "-H": "--header",
  "-t": "--template",
  "-p": "--preview",
  "-i": "--include",
};
const GH_SHORT_OTHER: Readonly<Record<string, string>> = {
  "-t": "--title",
  "-b": "--body",
  "-F": "--body-file",
  "-l": "--label",
  "-a": "--assignee",
  "-m": "--milestone",
  "-p": "--project",
  "-c": "--comment",
  "-r": "--reason",
  "-w": "--web",
  "-e": "--editor",
  "-T": "--template",
};

/** The long name of a flag word (without any `=value`), given the group it appears in. */
function longFlag(name: string, group: string | null): string {
  if (name.startsWith("--")) return name;
  const map = group === "api" ? GH_SHORT_API : GH_SHORT_OTHER;
  return GH_SHORT_COMMON[name] ?? map[name] ?? name;
}

/** The group: the first positional word, skipping flags and the values of the global value flags. */
function groupOf(tokens: readonly ShellToken[]): string | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]?.text ?? "";
    if (t === "-R" || t === "--repo" || t === "--hostname") {
      i++;
      continue;
    }
    if (t.startsWith("-") && t !== "-") continue;
    return t;
  }
  return null;
}

/**
 * Normalises the words after `gh` (`tokens` excludes the `gh` word itself):
 * `--flag=value` becomes `--flag value`; a short flag maps to its long name
 * (`-F` is `--body-file` outside `gh api` and `--field` inside it); a value
 * short flag may carry its value attached (`-XPOST`); the global `-R/--repo`
 * and `--hostname` are read wherever they stand. `refs` is every positional
 * after the verb, a bare positive integer written `#N`. An unknown flag, a
 * cluster of short flags (`-if`) included, keeps its name as written. Never
 * throws.
 */
export function ghSegment(tokens: readonly ShellToken[]): GhSegment {
  const group = groupOf(tokens);
  const flags = new Map<string, string[]>();
  const expanded = new Set<string>();
  const positionals: string[] = [];
  const add = (name: string, value: ShellToken | null): void => {
    const values = flags.get(name) ?? [];
    if (value !== null) {
      values.push(value.text);
      if (value.expanded) expanded.add(name);
    }
    flags.set(name, values);
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as ShellToken;
    const t = token.text;
    if (!t.startsWith("-") || t === "-") {
      positionals.push(t);
      continue;
    }
    if (t === "--") {
      for (const rest of tokens.slice(i + 1)) positionals.push(rest.text);
      break;
    }
    const eq = t.indexOf("=");
    if (t.startsWith("--") && eq !== -1) {
      add(t.slice(0, eq), { text: t.slice(eq + 1), expanded: token.expanded });
      continue;
    }
    if (!t.startsWith("--") && t.length > 2) {
      // `-XPOST`: a value short flag with its value attached.
      const name = longFlag(t.slice(0, 2), group);
      if (GH_VALUE_FLAGS.has(name)) {
        add(name, { text: t.slice(2).replace(/^=/, ""), expanded: token.expanded });
        continue;
      }
    }
    const name = longFlag(t, group);
    if (GH_VALUE_FLAGS.has(name)) {
      const value = tokens[i + 1];
      add(name, value ?? null);
      i++;
      continue;
    }
    add(name, null);
  }

  const verb = positionals[1] ?? null;
  const refs = positionals.slice(2).map((p) => (/^[1-9][0-9]*$/.test(p) ? `#${p}` : p));
  const repos = flags.get("--repo") ?? [];
  return { group: positionals[0] ?? group, verb, refs, repo: repos.length > 0 ? (repos[repos.length - 1] as string) : null, flags, expanded };
}
