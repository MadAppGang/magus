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
