#!/usr/bin/env bun
import { describe, expect, test } from "bun:test";
import {
  evaluate,
  extractTmuxTargets,
  isKillServer,
  isShell,
  splitClauses,
  tokenize,
  type TmuxTarget,
} from "./block-tmux-kill.ts";

describe("isShell", () => {
  test.each(["zsh", "bash", "fish", "sh", "dash", "-zsh", "-bash", "ksh"])(
    "allows shell %s",
    (s) => expect(isShell(s)).toBe(true),
  );
  test.each(["claude", "vim", "nvim", "psql", "node", "python", "irb", "mongosh", "less", "htop"])(
    "rejects non-shell %s",
    (s) => expect(isShell(s)).toBe(false),
  );
  test("trims whitespace", () => expect(isShell("  zsh\n")).toBe(true));
});

describe("isKillServer", () => {
  test("plain", () => expect(isKillServer("tmux kill-server")).toBe(true));
  test("with socket flag", () => expect(isKillServer("tmux -L default kill-server")).toBe(true));
  test("chained", () => expect(isKillServer("echo hi && tmux kill-server")).toBe(true));
  test("unrelated", () => expect(isKillServer("tmux kill-pane -t %1")).toBe(false));
  test("with -S socket path", () => expect(isKillServer("tmux -S /tmp/s kill-server")).toBe(true));
  test("kill-server as send-keys literal is NOT a kill-server command", () =>
    // Sending the text "kill-server" to a pane must not be mistaken for the verb.
    // (extractTmuxTargets still guards the send-keys itself.)
    expect(isKillServer("tmux send-keys -t %1 'kill-server'")).toBe(false));
});

describe("splitClauses", () => {
  test("splits on && ; | ||", () => {
    expect(splitClauses("a && b ; c | d || e")).toEqual(["a", "b", "c", "d", "e"]);
  });
  test("splits on newline", () => {
    expect(splitClauses("a\nb")).toEqual(["a", "b"]);
  });
});

describe("tokenize", () => {
  test("plain tokens", () =>
    expect(tokenize("tmux send-keys -t %34 clear")).toEqual(["tmux", "send-keys", "-t", "%34", "clear"]));
  test("double-quoted arg kept whole", () =>
    expect(tokenize('tmux send-keys -t %34 "ls -la"')).toEqual(["tmux", "send-keys", "-t", "%34", "ls -la"]));
  test("single-quoted arg kept whole", () =>
    expect(tokenize("tmux send-keys -t %34 'a b'")).toEqual(["tmux", "send-keys", "-t", "%34", "a b"]));
});

describe("extractTmuxTargets", () => {
  test("the incident command: split-window -t %32", () => {
    expect(extractTmuxTargets("tmux -L default split-window -h -t %32")).toEqual([
      { target: "%32", socketArgs: ["-L", "default"] },
    ]);
  });
  test("send-keys with separate -t", () => {
    expect(extractTmuxTargets("tmux send-keys -t %34 clear Enter")).toEqual([
      { target: "%34", socketArgs: [] },
    ]);
  });
  test("attached -t (-t%34)", () => {
    expect(extractTmuxTargets("tmux send-keys -t%34 clear")).toEqual([
      { target: "%34", socketArgs: [] },
    ]);
  });
  test("-t=%34 form", () => {
    expect(extractTmuxTargets("tmux send-keys -t=%34 clear")).toEqual([
      { target: "%34", socketArgs: [] },
    ]);
  });
  test("kill-pane carries socket via -S", () => {
    expect(extractTmuxTargets("tmux -S /tmp/sock kill-pane -t %5")).toEqual([
      { target: "%5", socketArgs: ["-S", "/tmp/sock"] },
    ]);
  });
  test("attached socket flag (-Ldefault)", () => {
    expect(extractTmuxTargets("tmux -Ldefault send-keys -t %1 x")).toEqual([
      { target: "%1", socketArgs: ["-L", "default"] },
    ]);
  });
  test("chained clauses produce multiple targets", () => {
    expect(extractTmuxTargets("tmux send-keys -t %1 a && tmux kill-pane -t %2")).toEqual([
      { target: "%1", socketArgs: [] },
      { target: "%2", socketArgs: [] },
    ]);
  });
  test("no explicit -t → no target (acts on current pane, unattributable)", () => {
    expect(extractTmuxTargets("tmux send-keys clear")).toEqual([]);
  });
  test("non-targeting verb ignored", () => {
    expect(extractTmuxTargets("tmux capture-pane -t %1 -p")).toEqual([]);
  });
  test("non-tmux command ignored", () => {
    expect(extractTmuxTargets("ssh host send-keys -t %1")).toEqual([]);
  });
});

describe("evaluate — the decision gate", () => {
  const yes = () => true;
  const shell = (_t: TmuxTarget) => "zsh";
  const claude = (_t: TmuxTarget) => "claude";
  const repl = (_t: TmuxTarget) => "psql";
  const unresolved = (_t: TmuxTarget) => "";

  test("blocks kill-server outright", () => {
    expect(evaluate("tmux kill-server", shell, yes)).toContain("kill-server would destroy");
  });

  test("BLOCKS the incident: send-keys into a claude pane", () => {
    const msg = evaluate("tmux -L default send-keys -t %34 'clear'", claude, yes);
    expect(msg).toContain("foreground process is 'claude'");
    expect(msg).toContain("sibling agent");
  });

  test("the advice names the slot-addressed MCP tools, never a pane-id tool", () => {
    const msg = evaluate("tmux -L default send-keys -t %34 'clear'", claude, yes) ?? "";
    for (const tool of ["open-pane", "send-keys", "close-pane"]) {
      expect(msg).toContain(`mcp__plugin_terminal_mux__${tool}`);
    }
    expect(msg).not.toContain("mcp__tmux__");
    expect(msg).not.toContain("split-pane");
    expect(msg).not.toContain("kill-pane");
  });

  test("BLOCKS kill-pane on a claude pane (the kill step)", () => {
    expect(evaluate("tmux -L default kill-pane -t %34", claude, yes)).toContain("'claude'");
  });

  test("BLOCKS send-keys into a REPL pane", () => {
    expect(evaluate("tmux send-keys -t %5 'select 1'", repl, yes)).toContain("'psql'");
  });

  test("ALLOWS send-keys into a bare shell pane", () => {
    expect(evaluate("tmux send-keys -t %66 'bun test'", shell, yes)).toBeNull();
  });

  test("ALLOWS when target foreground cannot be resolved (fail-open)", () => {
    expect(evaluate("tmux send-keys -t %99 x", unresolved, yes)).toBeNull();
  });

  test("ALLOWS when tmux is unavailable (fail-open)", () => {
    expect(evaluate("tmux send-keys -t %34 x", claude, () => false)).toBeNull();
  });

  test("ALLOWS read-only capture-pane regardless of foreground", () => {
    expect(evaluate("tmux capture-pane -t %34 -p", claude, yes)).toBeNull();
  });

  test("ALLOWS non-tmux commands", () => {
    expect(evaluate("git commit -m 'send-keys to kill-pane'", claude, yes)).toBeNull();
  });

  test("blocks if ANY chained clause targets a claude pane", () => {
    const lookup = (t: TmuxTarget) => (t.target === "%2" ? "claude" : "zsh");
    expect(evaluate("tmux send-keys -t %1 ok && tmux send-keys -t %2 bad", lookup, yes)).toContain("'claude'");
  });
});

const absent = () => "";
const installed = () => true;
const unavailable = () => false;
const env = { HERDR_PANE_ID: "wG:p59", HERDR_BIN_PATH: "/example/bin/herdr", QA_MUX: "/example/bin/herdr" };

const blocked = [
  ["herdr pane send-text w9:p8R test", "pane", "send-text", "w9:p8R", false],
  ["herdr pane send-keys wG:p59 enter", "pane", "send-keys", "wG:p59", false],
  ["herdr pane run wG:p59 test", "pane", "run", "wG:p59", false],
  ["herdr pane close wG:p59", "pane", "close", "wG:p59", false],
  ["herdr agent prompt reviewer 'do x'", "agent", "prompt", "reviewer", false],
  ["herdr agent send-keys w9:p8R enter", "agent", "send-keys", "w9:p8R", false],
  ['herdr pane run "$HERDR_PANE_ID" echo', "pane", "run", "wG:p59", false],
  ["herdr pane close -- wG:p59", "pane", "close", "wG:p59", false],
  ["herdr --session work pane run wG:p59 echo", "pane", "run", "wG:p59", true],
  ["herdr --session=work pane run wG:p59 echo", "pane", "run", "wG:p59", true],
  ["herdr agent prompt --wait reviewer test", "agent", "prompt", "reviewer", false],
  ["herdr agent prompt --until=idle --timeout 500 reviewer test", "agent", "prompt", "reviewer", false],
  ["herdr pane run wG:p59 ls --help", "pane", "run", "wG:p59", false],
  ["herdr pane send-text wG:p59 --help", "pane", "send-text", "wG:p59", false],
  ["'herdr' 'pane' 'close' 'wG:p59'", "pane", "close", "wG:p59", false],
  ['"$HERDR_BIN_PATH" pane close wG:p59', "pane", "close", "wG:p59", false],
  ['"$QA_MUX" pane close wG:p59', "pane", "close", "wG:p59", false],
  ...["env QA=1", "sudo", "timeout 2", "nice", "nohup", "command", "exec", "echo ok &&"].map(
    (prefix) => [`${prefix} herdr pane close wG:p59`, "pane", "close", "wG:p59", false] as const),
] as const;

for (const [command, kind, verb, target, scoped] of blocked) {
  test(`[REQ-1] blocks ${command} against a Claude ${kind}`, () => {
    const message = evaluate(command, absent, unavailable, t =>
      t.kind === kind && t.verb === verb && t.target === target &&
      JSON.stringify(t.sessionArgs) === JSON.stringify(scoped ? ["--session", "work"] : []) ? "claude" : "",
    installed, env);
    const ending = kind === "pane" ? `pane '${target}', whose foreground process is 'claude' — not a shell.`
      : `agent '${target}' (claude).`;
    expect(message?.split("\n")[0]).toBe(
      `BLOCKED: raw 'herdr ${kind} ${verb}' would ${kind === "pane" ? "target" : "type into"} ${ending}`);
  });
}

for (const [command, scope] of [
  ["herdr server stop", "in this herdr server."],
  ["herdr --session=work server stop", "in this herdr server."],
  ["herdr session stop work", "in session 'work'."],
  ["herdr session stop --json work", "in session 'work'."],
]) {
  test(`[REQ-1] blocks ${command} without a binary or lookup`, () => {
    const verb = scope.includes("server") ? "server" : "session";
    expect(evaluate(command!, absent, unavailable, absent, unavailable)?.split("\n")[0]).toBe(
      `BLOCKED: herdr ${verb} stop would close every pane and agent ${scope}`);
  });
}

for (const command of ["herdr --help", "herdr pane --help", "herdr pane send-text --help",
  "herdr agent prompt -h", "herdr pane split --current --direction right",
  "herdr --machine=box pane close w1:p1", "echo herdr pane close w1:p1"]) {
  test(`[REQ-2] allows ${command}`, () => {
    expect(evaluate(command, absent, unavailable, () => "claude", installed, env)).toBeNull();
  });
}

for (const [foreground, available] of [["zsh", true], ["-zsh", true], ["", true], ["claude", false]] as const) {
  test(`[REQ-2] allows a shell or unresolved lookup: ${foreground || "empty"}, available=${available}`, () => {
    expect(evaluate("herdr pane send-text w9:p8R x", absent, unavailable, () => foreground, () => available)).toBeNull();
  });
}
